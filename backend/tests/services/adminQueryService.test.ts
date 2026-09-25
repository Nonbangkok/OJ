import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import * as db from '../../db';
import {
  createAdminUser,
  createBatchUsers,
  deleteAdminUser,
  dropAllTablesForImport,
  getAuthors,
  getAdminUsers,
  getRegistrationEnabled,
  updateRegistrationEnabled,
  updateAdminUser,
} from '../../services/adminQueryService';

jest.mock('../../db', () => {
  // Mirror the real module: withTransaction runs on a pool client whose
  // queries forward to the shared query mock (see tests/setup.ts), so the
  // sequential mockResolvedValueOnce chains below cover BEGIN/COMMIT too.
  const query = jest.fn();
  const client = { query };
  return {
    query,
    pool: { connect: jest.fn(async () => client) },
    withTransaction: jest.fn(async (body: (c: { query: typeof query }) => Promise<unknown>) => {
      await query('BEGIN');
      try {
        const result = await body(client);
        await query('COMMIT');
        return result;
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    }),
  };
});

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

jest.mock('crypto', () => ({
  randomInt: jest.fn(),
}));

describe('adminQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (randomInt as jest.Mock).mockReturnValue(0);
    (bcrypt.hash as jest.Mock).mockImplementation(async (value: string) => `hash-${value}`);
  });

  it('createAdminUser should return duplicate when username already exists', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{}] });

    const result = await createAdminUser('alice', 'password', 'staff', 10);

    expect(result).toEqual({ kind: 'duplicate_username' });
  });

  it('createAdminUser should create user when username is available', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 7, username: 'alice', role: 'staff', created_at: new Date() }],
      });

    const result = await createAdminUser('alice', 'password', 'staff', 10);

    expect(bcrypt.hash).toHaveBeenCalledWith('password', 10);
    expect(result).toEqual({
      kind: 'ok',
      data: { id: 7, username: 'alice', role: 'staff' },
    });
  });

  it('updateAdminUser should block protected account', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ username: 'Nonbangkok' }] });

    const result = await updateAdminUser('1', 'new-name', 'admin');

    expect(result).toEqual({ kind: 'protected_user' });
  });

  it('updateAdminUser should return not_found when user does not exist', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] });

    const result = await updateAdminUser('404', 'name', 'staff');

    expect(result).toEqual({ kind: 'not_found' });
  });

  it('updateAdminUser should return duplicate_username when target username already exists', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ username: 'old-name' }] })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = await updateAdminUser('1', 'taken-name', 'staff');

    expect(result).toEqual({ kind: 'duplicate_username' });
  });

  it('updateAdminUser should update user successfully and invalidate their sessions (ADMIN-001)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ username: 'old-name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, username: 'new-name', role: 'staff', created_at: new Date() }],
      })
      .mockResolvedValueOnce({}) // session delete
      .mockResolvedValueOnce({}); // COMMIT

    const result = await updateAdminUser('1', 'new-name', 'staff');

    expect(result).toEqual({
      kind: 'ok',
      data: { id: 1, username: 'new-name', role: 'staff' },
    });
    // The edited user's stored sessions are dropped inside the same
    // transaction (connect-pg-simple stores userId inside JSONB sess).
    expect(db.query).toHaveBeenCalledWith(
      "DELETE FROM user_sessions WHERE sess->>'userId' = $1",
      ['1'],
    );
    expect(db.query).toHaveBeenCalledWith('COMMIT');
  });

  it('updateAdminUser checks username collisions case-insensitively (DB-08)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ username: 'old-name' }] })
      .mockResolvedValueOnce({ rows: [{}] }); // case-variant collision

    const result = await updateAdminUser('1', 'Old-Name', 'staff');

    expect(result).toEqual({ kind: 'duplicate_username' });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
      ['Old-Name', '1'],
    );
    // No UPDATE ran for the rejected rename.
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET username'),
      expect.anything(),
    );
  });

  it('updateAdminUser rolls back when a step fails mid-transaction (DB-04)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ username: 'old-name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('update failed'));

    await expect(updateAdminUser('1', 'new-name', 'staff')).rejects.toThrow('update failed');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('deleteAdminUser should return protected_user for Nonbangkok', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ username: 'Nonbangkok' }] });

    const result = await deleteAdminUser('1');

    expect(result).toEqual({ kind: 'protected_user' });
  });

  it('deleteAdminUser should return ok when user does not exist', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const result = await deleteAdminUser('99');

    expect(result).toEqual({ kind: 'ok' });
  });

  it('deleteAdminUser should delete submissions, sessions, and the user atomically (AUTH-002/003, DB-04)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ username: 'normal-user' }] })
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // delete submissions
      .mockResolvedValueOnce({}) // delete sessions
      .mockResolvedValueOnce({}) // delete user
      .mockResolvedValueOnce({}); // COMMIT

    const result = await deleteAdminUser('2');

    expect(result).toEqual({ kind: 'ok' });
    expect(db.query).toHaveBeenCalledWith('BEGIN');
    expect(db.query).toHaveBeenCalledWith('DELETE FROM submissions WHERE user_id = $1', ['2']);
    expect(db.query).toHaveBeenCalledWith("DELETE FROM user_sessions WHERE sess->>'userId' = $1", ['2']);
    expect(db.query).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', ['2']);
    expect(db.query).toHaveBeenCalledWith('COMMIT');
  });

  it('deleteAdminUser rolls the whole deletion back when a step fails (DB-04)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ username: 'normal-user' }] })
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('delete failed'));

    await expect(deleteAdminUser('2')).rejects.toThrow('delete failed');

    // Nothing committed: submissions/sessions/user all survive.
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.query).not.toHaveBeenCalledWith('COMMIT');
    expect(db.query).not.toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', ['2']);
  });

  it('createAdminUser rejects case-variant duplicates (DB-08)', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{}] });

    const result = await createAdminUser('Alice', 'password', 'staff', 10);

    expect(result).toEqual({ kind: 'duplicate_username' });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)',
      ['Alice'],
    );
  });

  it('createAdminUser maps a unique-violation race on INSERT to duplicate_username (DB-08)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: '23505', constraint: 'users_username_lower_unique' });

    const result = await createAdminUser('alice', 'password', 'staff', 10);

    expect(result).toEqual({ kind: 'duplicate_username' });
  });

  it('createBatchUsers should rollback and return duplicate_username when collision occurs', async () => {
    const queryMock = jest.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{}] }) // existing user
      .mockResolvedValueOnce({}); // ROLLBACK
    const releaseMock = jest.fn();
    (db.pool.connect as jest.Mock).mockResolvedValue({ query: queryMock, release: releaseMock });

    const result = await createBatchUsers({
      prefix: 'team',
      count: 1,
      saltRounds: 10,
      passwordLength: 4,
    });

    expect(result).toEqual({ kind: 'duplicate_username', username: 'team-01' });
    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('createBatchUsers should commit and return generated users', async () => {
    const queryMock = jest.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // exists check user1
      .mockResolvedValueOnce({}) // insert user1
      .mockResolvedValueOnce({ rows: [] }) // exists check user2
      .mockResolvedValueOnce({}) // insert user2
      .mockResolvedValueOnce({}); // COMMIT
    const releaseMock = jest.fn();
    (db.pool.connect as jest.Mock).mockResolvedValue({ query: queryMock, release: releaseMock });

    const result = await createBatchUsers({
      prefix: 'team',
      count: 2,
      saltRounds: 10,
      passwordLength: 4,
    });

    expect(result).toEqual({
      kind: 'ok',
      users: [
        { username: 'team-01', password: 'aaaa' },
        { username: 'team-02', password: 'aaaa' },
      ],
    });
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('createBatchUsers checks collisions case-insensitively (DB-08)', async () => {
    const queryMock = jest.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{}] }) // case-variant collision on user1
      .mockResolvedValueOnce({}); // ROLLBACK
    const releaseMock = jest.fn();
    (db.pool.connect as jest.Mock).mockResolvedValue({ query: queryMock, release: releaseMock });

    const result = await createBatchUsers({
      prefix: 'Team',
      count: 1,
      saltRounds: 10,
      passwordLength: 4,
    });

    expect(result).toEqual({ kind: 'duplicate_username', username: 'Team-01' });
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)',
      ['Team-01'],
    );
    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });

  it('getRegistrationEnabled should default to true when setting is missing', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const enabled = await getRegistrationEnabled();

    expect(enabled).toBe(true);
  });

  it('getRegistrationEnabled should return false when setting is false', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'false' }] });

    const enabled = await getRegistrationEnabled();

    expect(enabled).toBe(false);
  });

  it('should list admin users and authors', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 1, username: 'admin', role: 'admin' }] });
    const users = await getAdminUsers();

    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 2, username: 'staff' }] });
    const authors = await getAuthors();

    expect(users.length).toBe(1);
    expect(authors.length).toBe(1);
  });

  it('updateRegistrationEnabled should execute update query', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({});

    await updateRegistrationEnabled(true);

    expect(db.query).toHaveBeenCalledWith(
      "UPDATE system_settings SET setting_value = $1 WHERE setting_key = 'registration_enabled'",
      ['true']
    );
  });

  it('dropAllTablesForImport tears down the whole public schema (DB-01)', async () => {
    (db.query as jest.Mock).mockResolvedValue({});

    await dropAllTablesForImport();

    // Schema-level teardown: every migration-created table (including
    // collections, user_problem_rewards, authoring_profile_sync*) goes away,
    // and a fresh public schema is left for the restore.
    expect(db.query).toHaveBeenCalledWith('DROP SCHEMA public CASCADE');
    expect(db.query).toHaveBeenCalledWith('CREATE SCHEMA public');
  });
});
