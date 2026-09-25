import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import * as db from '../db';
import { ADMIN_USER_LIST_CONFIG, USER_ROLES } from '../constants';
import { isUniqueViolation } from '../utils/dbErrors';
import {
  AdminAuthorListRow,
  AdminCreateUserResult,
  AdminDeleteUserResult,
  AdminUpdateUserResult,
  AdminUserListRow,
  BatchUserBuildInput,
  CreateBatchUsersResult,
  RegistrationSettingRow,
} from '../types/service';

const RANDOM_PASSWORD_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
const PROTECTED_ADMIN_USERNAME = 'Nonbangkok';

const buildRandomPassword = (passwordLength: number): string => {
  let password = '';
  for (let index = 0; index < passwordLength; index += 1) {
    password += RANDOM_PASSWORD_CHARSET.charAt(randomInt(RANDOM_PASSWORD_CHARSET.length));
  }
  return password;
};

export interface AdminUsersPage {
  users: AdminUserListRow[];
  /** Total user count, so the UI can page without over-fetching. */
  total: number;
  page: number;
  limit: number;
}

/**
 * Admin user list (ADMIN-008). Previously returned the entire table in one
 * response; now paginated. `limit` is capped at ADMIN_USER_LIST_MAX_LIMIT.
 */
export const getAdminUsers = async (
  page: number = 1,
  limit: number = ADMIN_USER_LIST_CONFIG.DEFAULT_LIMIT,
): Promise<AdminUsersPage> => {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), ADMIN_USER_LIST_CONFIG.MAX_LIMIT);
  const offset = (safePage - 1) * safeLimit;

  const [rowsResult, countResult] = await Promise.all([
    db.query<AdminUserListRow>(
      'SELECT id, username, role, created_at FROM users ORDER BY id LIMIT $1 OFFSET $2',
      [safeLimit, offset],
    ),
    db.query<{ total: string }>('SELECT COUNT(*) AS total FROM users'),
  ]);

  return {
    users: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    page: safePage,
    limit: safeLimit,
  };
};

export const createAdminUser = async (
  username: string,
  password: string,
  role: string,
  saltRounds: number,
): Promise<AdminCreateUserResult> => {
  // DB-08: uniqueness is case-insensitive (unique index on LOWER(username)),
  // so the pre-check must compare case-insensitively too.
  const existingUser = await db.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (existingUser.rows.length > 0) {
    return { kind: 'duplicate_username' };
  }

  const hashedPassword = await bcrypt.hash(password, saltRounds);
  try {
    const createdUser = await db.query<AdminUserListRow>(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, hashedPassword, role]
    );

    const { id, role: createdRole } = createdUser.rows[0];
    return {
      kind: 'ok',
      data: { id, username, role: createdRole },
    };
  } catch (error) {
    // The pre-check can race a concurrent registration; the index is the
    // real guarantee.
    if (isUniqueViolation(error)) return { kind: 'duplicate_username' };
    throw error;
  }
};

export const updateAdminUser = async (
  userId: string,
  username: string,
  role: string,
): Promise<AdminUpdateUserResult> => {
  return db.withTransaction(async (client) => {
    const userToEdit = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
    if (userToEdit.rows.length === 0) {
      return { kind: 'not_found' } as const;
    }
    if (userToEdit.rows[0].username === PROTECTED_ADMIN_USERNAME) {
      return { kind: 'protected_user' } as const;
    }

    // DB-08: case-insensitive duplicate check, matching the LOWER(username)
    // unique index.
    const existingUser = await client.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username, userId]);
    if (existingUser.rows.length > 0) {
      return { kind: 'duplicate_username' } as const;
    }

    let updatedUser;
    try {
      updatedUser = await client.query<AdminUserListRow>(
        'UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role, created_at',
        [username, role, userId]
      );
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'duplicate_username' } as const;
      throw error;
    }

    if (updatedUser.rows.length === 0) {
      return { kind: 'not_found' } as const;
    }

    // ADMIN-001: drop the edited user's stored sessions so the change is not
    // visible only through per-request revalidation. connect-pg-simple stores
    // sessions as JSONB, so match on the embedded userId.
    await client.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [userId]);

    const { id, role: updatedRole } = updatedUser.rows[0];
    return {
      kind: 'ok' as const,
      data: { id, username, role: updatedRole },
    };
  });
};

export const deleteAdminUser = async (userId: string): Promise<AdminDeleteUserResult> => {
  const userToDelete = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
  // ADMIN-007: deleting a nonexistent id previously reported success —
  // surface it as not_found so the controller can answer 404.
  if (userToDelete.rows.length === 0) {
    return { kind: 'not_found' };
  }
  if (userToDelete.rows[0].username === PROTECTED_ADMIN_USERNAME) {
    return { kind: 'protected_user' };
  }

  // DB-04: the per-table deletes are one transaction so a failure between
  // steps can no longer leave a half-deleted user (submissions gone but the
  // account row surviving, etc.). Per-table cascade behavior is unchanged.
  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM submissions WHERE user_id = $1', [userId]);
    // AUTH-002/003: kill the deleted user's sessions at the source. Per-request
    // revalidation already treats a missing users row as unauthenticated; this
    // also clears the stored rows so the sessions cannot outlive the account.
    await client.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  });
  return { kind: 'ok' };
};

export const createBatchUsers = async (input: BatchUserBuildInput): Promise<CreateBatchUsersResult> => {
  const createdUsers: Array<{ username: string; password: string }> = [];
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    for (let index = 1; index <= input.count; index += 1) {
      const username = `${input.prefix}-${index.toString().padStart(2, '0')}`;
      const password = buildRandomPassword(input.passwordLength);
      const hashedPassword = await bcrypt.hash(password, input.saltRounds);

      const existingUser = await client.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (existingUser.rows.length > 0) {
        await client.query('ROLLBACK');
        return { kind: 'duplicate_username', username };
      }

      await client.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [username, hashedPassword, USER_ROLES.USER]
      );
      createdUsers.push({ username, password });
    }

    await client.query('COMMIT');
    return { kind: 'ok', users: createdUsers };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getAuthors = async (): Promise<AdminAuthorListRow[]> => {
  const result = await db.query<AdminAuthorListRow>(
    "SELECT id, username FROM users WHERE role = 'admin' OR role = 'staff' ORDER BY username"
  );
  return result.rows;
};

type ImportDatabase = {
  query: (text: string) => Promise<unknown>;
};

/**
 * DB-01: tear the whole public schema down instead of dropping a
 * hand-maintained table list. The list had already drifted (collections,
 * user_problem_rewards, authoring_profile_syncs, authoring_profile_sync_items
 * survived the drop), which both stranded stale data and broke
 * self-export→import roundtrips (restore fails on CREATE TABLE after the
 * destructive drop). Schema-level teardown is introspection-free and
 * future-proof: any table any migration ever created goes away.
 */
export const dropAllTablesForImport = async (database: ImportDatabase = db): Promise<void> => {
  await database.query('DROP SCHEMA public CASCADE');
  await database.query('CREATE SCHEMA public');
};

export const getRegistrationEnabled = async (): Promise<boolean> => {
  const result = await db.query<RegistrationSettingRow>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'"
  );
  if (result.rows.length === 0) {
    return true;
  }
  return result.rows[0].setting_value === 'true';
};

export const updateRegistrationEnabled = async (enabled: boolean): Promise<void> => {
  await db.query(
    "UPDATE system_settings SET setting_value = $1 WHERE setting_key = 'registration_enabled'",
    [enabled.toString()]
  );
};
