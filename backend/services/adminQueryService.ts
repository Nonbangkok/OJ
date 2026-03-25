import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import * as db from '../db';
import { USER_ROLES } from '../constants';
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

export const getAdminUsers = async (): Promise<AdminUserListRow[]> => {
  const result = await db.query<AdminUserListRow>('SELECT id, username, role, created_at FROM users ORDER BY id');
  return result.rows;
};

export const createAdminUser = async (
  username: string,
  password: string,
  role: string,
  saltRounds: number,
): Promise<AdminCreateUserResult> => {
  const existingUser = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (existingUser.rows.length > 0) {
    return { kind: 'duplicate_username' };
  }

  const hashedPassword = await bcrypt.hash(password, saltRounds);
  const createdUser = await db.query<AdminUserListRow>(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
    [username, hashedPassword, role]
  );

  const { id, role: createdRole } = createdUser.rows[0];
  return {
    kind: 'ok',
    data: { id, username, role: createdRole },
  };
};

export const updateAdminUser = async (
  userId: string,
  username: string,
  role: string,
): Promise<AdminUpdateUserResult> => {
  const userToEdit = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
  if (userToEdit.rows.length === 0) {
    return { kind: 'not_found' };
  }
  if (userToEdit.rows[0].username === PROTECTED_ADMIN_USERNAME) {
    return { kind: 'protected_user' };
  }

  const existingUser = await db.query('SELECT 1 FROM users WHERE username = $1 AND id != $2', [username, userId]);
  if (existingUser.rows.length > 0) {
    return { kind: 'duplicate_username' };
  }

  const updatedUser = await db.query<AdminUserListRow>(
    'UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role, created_at',
    [username, role, userId]
  );

  if (updatedUser.rows.length === 0) {
    return { kind: 'not_found' };
  }

  const { id, role: updatedRole } = updatedUser.rows[0];
  return {
    kind: 'ok',
    data: { id, username, role: updatedRole },
  };
};

export const deleteAdminUser = async (userId: string): Promise<AdminDeleteUserResult> => {
  const userToDelete = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
  if (userToDelete.rows.length === 0) {
    return { kind: 'ok' };
  }
  if (userToDelete.rows[0].username === PROTECTED_ADMIN_USERNAME) {
    return { kind: 'protected_user' };
  }

  await db.query('DELETE FROM submissions WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
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

      const existingUser = await client.query('SELECT 1 FROM users WHERE username = $1', [username]);
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

export const dropAllTablesForImport = async (): Promise<void> => {
  await db.query('DROP TABLE IF EXISTS contest_scoreboards CASCADE;');
  await db.query('DROP TABLE IF EXISTS contest_problems CASCADE;');
  await db.query('DROP TABLE IF EXISTS contest_submissions CASCADE;');
  await db.query('DROP TABLE IF EXISTS contest_participants CASCADE;');
  await db.query('DROP TABLE IF EXISTS contests CASCADE;');
  await db.query('DROP TABLE IF EXISTS submissions CASCADE;');
  await db.query('DROP TABLE IF EXISTS testcases CASCADE;');
  await db.query('DROP TABLE IF EXISTS problems CASCADE;');
  await db.query('DROP TABLE IF EXISTS users CASCADE;');
  await db.query('DROP TABLE IF EXISTS user_sessions CASCADE;');
  await db.query('DROP TABLE IF EXISTS system_settings CASCADE;');
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
