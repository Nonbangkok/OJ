import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import { EventEmitter } from 'events';
import adminRouter from '../controllers/adminController';
import * as db from '../db';
import { runMigrationsFromPool } from '../scripts/migrate';
import { errorHandler } from '../middleware/errorHandler';
import { resetPasswordChangeEnabledCache } from '../services/siteSettingsService';

// Mock Dependencies
jest.mock('../db', () => {
    const query = jest.fn();
    // AUTH-004: withTransaction forwards to query by default so per-test
    // query mocks keep working inside transactional services (the global
    // setup does the same for the auto-mocked db module).
    const withTransaction = jest.fn(async (body: (client: { query: typeof query }) => Promise<unknown>) => {
        const client = { query };
        await client.query('BEGIN');
        try {
            const result = await body(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
    return {
        query,
        pool: { query, connect: jest.fn() },
        withTransaction,
        // DB-10: the import flow runs migrations on a dedicated unlimited pool.
        createMigrationsPool: jest.fn(() => ({ connect: jest.fn(async () => ({ query, release: jest.fn() })), end: jest.fn() })),
    };
});
jest.mock('../scripts/migrate', () => ({
    runMigrationsFromPool: jest.fn().mockResolvedValue([]),
}));
jest.mock('../middleware/auth', () => ({
    requireStaffOrAdmin: (req: Request, _res: Response, next: NextFunction) => {
        req.user = { id: 1, username: 'admin', role: 'admin', hasAvatar: false };
        next();
    },
    requireAdmin: (req: Request, _res: Response, next: NextFunction) => {
        req.user = { id: 1, username: 'admin', role: 'admin', hasAvatar: false };
        next();
    },
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.user = { id: 1, username: 'admin', role: 'admin', hasAvatar: false };
        next();
    }
}));

// Drive the database-import flow deterministically without touching the real DB
// or spawning psql/pg_restore, so we can assert the per-job token behaviour.
jest.mock('../middleware/upload', () => ({
    diskUpload: {
        single: () => (req: Request, _res: Response, next: NextFunction) => {
            req.file = {
                path: '/tmp/mock-dump.sql',
                originalname: 'dump.sql',
            } as Express.Multer.File;
            next();
        }
    }
}));
jest.mock('child_process', () => ({
    exec: jest.fn(),
    spawn: jest.fn(() => {
        const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
        child.stderr = new EventEmitter();
        // Resolve the import as a success on the next tick.
        setImmediate(() => child.emit('close', 0));
        return child;
    }),
}));

describe('Admin Controller', () => {
    let app: Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        // Self-edit/self-delete guards in the controller read req.user.
        app.use((req: Request, _res: Response, next: NextFunction) => {
            req.user = { id: 1, username: 'admin', role: 'admin', hasAvatar: false };
            next();
        });
        app.use('/', adminRouter);
        app.use(errorHandler);
        jest.clearAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('GET /admin/settings/registration', () => {
        it('should return site settings', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [
                    { setting_value: 'true' }
                ]
            });

            const res = await request(app).get('/admin/settings/registration');

            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(true);
        });
    });

    describe('PUT /admin/settings/registration', () => {
        it('should update registration settings successfully', async () => {
            const updates = { enabled: false };
            (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 }); // Mock map updates

            const res = await request(app)
                .put('/admin/settings/registration')
                .send(updates);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Registration setting updated successfully.');
            expect(db.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('GET /admin/settings/password-change', () => {
        beforeEach(() => {
            resetPasswordChangeEnabledCache();
        });

        it('should return the setting (default true on a missing row)', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/admin/settings/password-change');

            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(true);
        });

        it('should return enabled=false when the setting is false', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'false' }] });

            const res = await request(app).get('/admin/settings/password-change');

            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(false);
        });
    });

    describe('PUT /admin/settings/password-change', () => {
        beforeEach(() => {
            resetPasswordChangeEnabledCache();
        });

        it('should update the setting successfully', async () => {
            (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

            const res = await request(app)
                .put('/admin/settings/password-change')
                .send({ enabled: false });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Password change setting updated successfully.');
            // Upsert (INSERT ... ON CONFLICT), and the cache is refreshed so
            // no read-back query is needed.
            expect(db.query).toHaveBeenCalledTimes(1);
            const [sql, params] = (db.query as jest.Mock).mock.calls[0];
            expect(String(sql)).toContain('ON CONFLICT (setting_key) DO UPDATE');
            expect(params).toEqual(['password_change_enabled', 'false']);
        });

        it('should reject an invalid body with 400', async () => {
            const res = await request(app)
                .put('/admin/settings/password-change')
                .send({ enabled: 'yes' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });
    });

    describe('GET /admin/users', () => {
        it('should return a paged user list with a total count (ADMIN-008)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 2, username: 'user1', role: 'user' }] })
                .mockResolvedValueOnce({ rows: [{ total: '1' }] });

            const res = await request(app).get('/admin/users');

            expect(res.status).toBe(200);
            expect(res.body.users.length).toBe(1);
            expect(res.body.users[0].username).toBe('user1');
            expect(res.body.total).toBe(1);
            expect(res.body.page).toBe(1);
            expect(res.body.limit).toBe(100);
        });

        it('should pass page/limit through and reject bad values (ADMIN-008)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValue({ rows: [] })
                .mockResolvedValue({ rows: [{ total: '0' }] });

            const ok = await request(app).get('/admin/users?page=2&limit=50');
            expect(ok.status).toBe(200);
            expect(ok.body.page).toBe(2);
            expect(ok.body.limit).toBe(50);

            const tooHigh = await request(app).get('/admin/users?limit=501');
            expect(tooHigh.status).toBe(400);
            const zero = await request(app).get('/admin/users?page=0');
            expect(zero.status).toBe(400);
        });

        it('should return 404 when deleting a nonexistent user (ADMIN-007)', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).delete('/admin/users/999');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('User not found.');
        });
    });

    describe('PUT /admin/users/:id/password (AUTH-004)', () => {
        // The reset runs inside db.withTransaction; the global setup mocks
        // connect() to forward client statements to db.query, so queued
        // per-test mocks apply inside the transaction body too.
        const resetPassword = (id: number | string, body: object) =>
            request(app).put(`/admin/users/${id}/password`).send(body);

        it('should reject a weak new password with 400', async () => {
            const res = await resetPassword(2, { newPassword: 'short' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });

        it('should reject a non-numeric id with 400', async () => {
            const res = await resetPassword('abc', { newPassword: 'newpassword45' });

            expect(res.status).toBe(400);
        });

        it('should reset the password and delete ALL of the target sessions', async () => {
            const bcrypt = jest.requireActual('bcrypt');
            (db.query as jest.Mock)
                .mockResolvedValueOnce({}) // BEGIN
                // SELECT username inside the transaction
                .mockResolvedValueOnce({ rows: [{ username: 'user1' }] })
                .mockResolvedValue({ rowCount: 1 }); // UPDATE / DELETE / COMMIT

            const res = await resetPassword(2, { newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Password reset for user 2. They will need to sign in again.');

            const calls = (db.query as jest.Mock).mock.calls;
            const update = calls.find(([sql]) => String(sql).startsWith('UPDATE users SET password_hash'));
            expect(update).toBeDefined();
            // Stored bcrypt-hashed, never plaintext.
            await expect(bcrypt.compare('newpassword45', String(update![1][0]))).resolves.toBe(true);
            expect(update![1][1]).toBe('2');

            // ALL sessions of the target are dropped (no sid exclusion).
            const sessionDelete = calls.find(([sql]) => String(sql).startsWith('DELETE FROM user_sessions'));
            expect(sessionDelete![0]).toBe("DELETE FROM user_sessions WHERE sess->>'userId' = $1");
            expect(sessionDelete![1]).toEqual(['2']);

            const sqls = calls.map(([sql]) => String(sql));
            expect(sqls).toContain('BEGIN');
            expect(sqls).toContain('COMMIT');
        });

        it('should return 404 for a nonexistent target', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [] }); // SELECT

            const res = await resetPassword(999, { newPassword: 'newpassword45' });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('User not found.');
        });

        it('should refuse to reset the protected "Nonbangkok" account', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ username: 'Nonbangkok' }] }); // SELECT

            const res = await resetPassword(1, { newPassword: 'newpassword45' });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe(
                'The "Nonbangkok" account password can only be changed by its owner.',
            );
            // No password write may happen for the protected account.
            const sqls = (db.query as jest.Mock).mock.calls.map(([sql]) => String(sql));
            expect(sqls.some((sql) => sql.startsWith('UPDATE users SET password_hash'))).toBe(false);
        });

        it('should allow an admin to reset their own password here (all sessions die, admin must re-login)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ username: 'admin' }] }) // SELECT
                .mockResolvedValue({ rowCount: 1 }); // UPDATE / DELETE / COMMIT

            const res = await resetPassword(1, { newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
            const sessionDelete = (db.query as jest.Mock).mock.calls
                .find(([sql]) => String(sql).startsWith('DELETE FROM user_sessions'));
            expect(sessionDelete![1]).toEqual(['1']);
        });

        it('is NOT gated by the password_change_enabled setting (admin reset keeps working while self-service is off)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ username: 'user1' }] }) // SELECT
                .mockResolvedValue({ rowCount: 1 }); // UPDATE / DELETE / COMMIT

            const res = await resetPassword(2, { newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
            // The reset route must never consult the password_change_enabled
            // setting — no system_settings read at all.
            const settingReads = (db.query as jest.Mock).mock.calls
                .filter(([sql]) => String(sql).includes('system_settings'));
            expect(settingReads).toHaveLength(0);
        });

        it('should roll back when session deletion fails', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ username: 'user1' }] }) // SELECT
                .mockResolvedValueOnce({}) // UPDATE users
                .mockRejectedValueOnce(new Error('session store gone')); // DELETE

            const res = await resetPassword(2, { newPassword: 'newpassword45' });

            expect(res.status).toBe(500);
            const sqls = (db.query as jest.Mock).mock.calls.map(([sql]) => String(sql));
            expect(sqls).toContain('ROLLBACK');
            expect(sqls).not.toContain('COMMIT');
        });
    });

    describe('Database import progress token', () => {
        const startImport = async () => {
            const res = await request(app)
                .post('/admin/database/import')
                .attach('databaseDump', Buffer.from('-- sql'), 'dump.sql');
            return res;
        };

        it('should return a per-job token when an import starts', async () => {
            const res = await startImport();

            expect(res.status).toBe(202);
            expect(res.body.jobId).toBeDefined();
            expect(typeof res.body.token).toBe('string');
            expect(res.body.token.length).toBeGreaterThan(0);
        });

        it('should return 404 for an unknown import job regardless of token', async () => {
            const res = await request(app)
                .get('/admin/database/import-progress/does-not-exist').set('x-import-token', 'whatever');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Import job not found.');
        });

        it('should reject progress requests without the job token', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`);

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Invalid or missing import token.');
        });

        it('should reject progress requests with a wrong token', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`).set('x-import-token', 'wrong-token');

            expect(res.status).toBe(401);
        });

        it('should return progress (without the token) when the correct token is supplied', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`).set('x-import-token', start.body.token);

            expect(res.status).toBe(200);
            expect(res.body.status).toBeDefined();
            expect(res.body.message).toBeDefined();
            expect(res.body.token).toBeUndefined();
        });

        it('should accept the token via the x-import-token header', async () => {
            const start = await startImport();

            const res = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`)
                .set('x-import-token', start.body.token);

            expect(res.status).toBe(200);
            expect(res.body.token).toBeUndefined();
        });

        it('should run migrations after a successful database restore', async () => {
            const start = await startImport();

            await new Promise<void>((resolve) => setImmediate(resolve));
            await new Promise<void>((resolve) => setImmediate(resolve));

            // DB-10: migrations run on a dedicated pool (no statement_timeout),
            // not the shared app pool.
            expect(runMigrationsFromPool).toHaveBeenCalledTimes(1);
            expect(runMigrationsFromPool).not.toHaveBeenCalledWith(db.pool);

            const progress = await request(app)
                .get(`/admin/database/import-progress/${start.body.jobId}`)
                .set('x-import-token', start.body.token);
            expect(progress.body.status).toBe('completed');
        });
    });
});
