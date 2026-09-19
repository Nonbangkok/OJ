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
        connect: jest.fn(),
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
    // Transactional services call pool.connect() and query through the
    // returned client. Forward client statements to db.query so tests that
    // stub db.query (the norm) keep working inside transactions.
    if (db.pool && db.pool.connect) {
        (db.pool.connect as unknown as jest.Mock).mockReset();
        (db.pool.connect as unknown as jest.Mock).mockImplementation(async () => ({
            query: (...args: unknown[]) => (db.query as unknown as jest.Mock)(...(args as [])),
            release: jest.fn(),
        }));
    }
});

afterEach(() => {
    // A test file may have installed (and already restored) its own console
    // spies in a later afterEach hook; only restore the ones still mocked.
    const maybeRestore = (method: 'error' | 'warn'): void => {
        const spy = console[method] as unknown as jest.SpyInstance | undefined;
        if (typeof spy?.mockRestore === 'function') {
            spy.mockRestore();
        }
    };
    maybeRestore('error');
    maybeRestore('warn');
});
