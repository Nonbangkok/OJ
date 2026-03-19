import 'express-session';
import * as db from '../db';

declare module 'express-session' {
    interface SessionData {
        userId: number;
        role: string;
    }
}

// Global mock setup for pg to control database behavior
jest.mock('pg', () => {
    const mockPool = {
        query: jest.fn(),
    };
    return {
        Pool: jest.fn(() => mockPool),
    };
});

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
    
    // Reset all mocks to prevent test interference
    jest.clearAllMocks();
    
    // Ensure db.pool.query is properly mocked
    if (db.pool && db.pool.query) {
        (db.pool.query as jest.Mock).mockReset();
    }
});

afterEach(() => {
    (console.error as unknown as jest.SpyInstance).mockRestore();
    (console.warn as unknown as jest.SpyInstance).mockRestore();
});
