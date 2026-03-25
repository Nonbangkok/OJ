import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import * as db from '../../db';
import {
  createAdminUser,
  createBatchUsers,
  deleteAdminUser,
  getAuthors,
  getAdminUsers,
  getRegistrationEnabled,
  updateRegistrationEnabled,
  updateAdminUser,
} from '../../services/adminQueryService';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
}));

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
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ username: 'Nonbangkok' }] });

    const result = await updateAdminUser('1', 'new-name', 'admin');

    expect(result).toEqual({ kind: 'protected_user' });
  });

  it('updateAdminUser should return not_found when user does not exist', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const result = await updateAdminUser('404', 'name', 'staff');

    expect(result).toEqual({ kind: 'not_found' });
  });

  it('updateAdminUser should return duplicate_username when target username already exists', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ username: 'old-name' }] })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = await updateAdminUser('1', 'taken-name', 'staff');

    expect(result).toEqual({ kind: 'duplicate_username' });
  });

  it('updateAdminUser should update user successfully', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ username: 'old-name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, username: 'new-name', role: 'staff', created_at: new Date() }],
      });

    const result = await updateAdminUser('1', 'new-name', 'staff');

    expect(result).toEqual({
      kind: 'ok',
      data: { id: 1, username: 'new-name', role: 'staff' },
    });
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

  it('deleteAdminUser should delete submissions and user', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ username: 'normal-user' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await deleteAdminUser('2');

    expect(result).toEqual({ kind: 'ok' });
    expect(db.query).toHaveBeenNthCalledWith(2, 'DELETE FROM submissions WHERE user_id = $1', ['2']);
    expect(db.query).toHaveBeenNthCalledWith(3, 'DELETE FROM users WHERE id = $1', ['2']);
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
});
