import * as db from '../db';

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
});
