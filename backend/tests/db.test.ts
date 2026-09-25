import * as db from '../db';
import { DATABASE_POOL } from '../constants';

describe('Database Module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should export a query function and the connection pool', () => {
        expect(db.query).toBeInstanceOf(Function);
        expect(db.pool).toBeDefined();
    });

    it('should pass queries to the underlying pg pool', async () => {
        const mockResult = { rows: [{ id: 1 }] };
        (db.pool.query as jest.Mock).mockResolvedValueOnce(mockResult);

        const text = 'SELECT * FROM users WHERE id = $1';
        const params = [1];
        const result = await db.query(text, params);

        expect(db.pool.query).toHaveBeenCalledWith(text, params);
        expect(result).toBe(mockResult);
    });

    it('sizes the app pool explicitly and applies a statement timeout (DB-10)', () => {
        expect(db.appPoolOptions.max).toBe(DATABASE_POOL.MAX_CONNECTIONS);
        expect(db.appPoolOptions.max).toBeGreaterThanOrEqual(20);
        expect(db.appPoolOptions.options).toBe(
            `-c statement_timeout=${DATABASE_POOL.STATEMENT_TIMEOUT_MS}`,
        );
    });

    it('runs a transaction body with BEGIN/COMMIT and releases the client (DB-04)', async () => {
        const client = {
            query: jest.fn().mockResolvedValue({ rows: [] }),
            release: jest.fn(),
        };
        (db.pool.connect as jest.Mock).mockResolvedValueOnce(client);

        const result = await db.withTransaction(async (c) => {
            await c.query('SELECT 1');
            return 'done';
        });

        expect(result).toBe('done');
        expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and rethrows when the transaction body fails (DB-04)', async () => {
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new Error('boom')),
            release: jest.fn(),
        };
        (db.pool.connect as jest.Mock).mockResolvedValueOnce(client);

        await expect(db.withTransaction(async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        const sqls = client.query.mock.calls.map(([sql]) => sql);
        expect(sqls).toContain('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});
