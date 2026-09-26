import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import authRouter from '../controllers/authController';
import * as db from '../db';
import bcrypt from 'bcrypt';
import { RATE_LIMIT_CONFIG } from '../constants';
import { recordLoginFailure, resetLoginFailureTracker } from '../middleware/rateLimit';
import { errorHandler } from '../middleware/errorHandler';

// Mock the database
jest.mock('../db');
// Site settings service: default enabled=true keeps every pre-existing
// password-change test on the historical behavior; gate tests override it.
jest.mock('../services/siteSettingsService', () => ({
    getSiteAccessMode: jest.fn().mockResolvedValue('public'),
    updateSiteAccessMode: jest.fn(),
    resetSiteAccessModeCache: jest.fn(),
    getPasswordChangeEnabled: jest.fn().mockResolvedValue(true),
    updatePasswordChangeEnabled: jest.fn(),
    resetPasswordChangeEnabledCache: jest.fn(),
}));

import { getPasswordChangeEnabled, getSiteAccessMode } from '../services/siteSettingsService';

describe('Auth Controller', () => {
    let app: Express;

    beforeEach(() => {
        resetLoginFailureTracker();
        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        app.use('/', authRouter);
        jest.resetAllMocks();
        // resetAllMocks drops the jest.mock factory implementations —
        // re-seed the defaults (historical behavior) every test.
        (getPasswordChangeEnabled as jest.Mock).mockResolvedValue(true);
        (getSiteAccessMode as jest.Mock).mockResolvedValue('public');
    });

    describe('POST /register', () => {
        it('should return 400 for invalid payload', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: '', password: '123' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
            expect(Array.isArray(res.body.errors)).toBe(true);
        });

        it('should return 403 if registration is disabled', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'false' }] });

            const res = await request(app)
                .post('/register')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Registration is currently disabled.');
        });

        it('should register a user successfully when enabled', async () => {
            // 1. Check registration enabled
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] });
            // 2. Check if username exists (no)
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            // 3. Insert user
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 1, username: 'testuser' }] });

            const res = await request(app)
                .post('/register')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('User registered successfully');
            expect(res.body.user.username).toBe('testuser');
        });

        it('should return 400 if username already exists', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 1, username: 'testuser' }] });

            const res = await request(app)
                .post('/register')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Username already exists');
        });

        // DB-08/AUTH-006: uniqueness is case-insensitive — a case variant of
        // an existing username must be rejected, not create a lookalike.
        it('should return 400 for a case-variant of an existing username', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 1, username: 'testuser' }] });

            const res = await request(app)
                .post('/register')
                .send({ username: 'TestUser', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Username already exists');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
                ['TestUser'],
            );
        });

        it('should map an INSERT unique-violation race to 400 (DB-08)', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce({ code: '23505', constraint: 'users_username_lower_unique' });

            const res = await request(app)
                .post('/register')
                .send({ username: 'raced-user', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Username already exists');
        });

        // AUTH-005: the Zod cap must match users.username VARCHAR(50) so a
        // 51–64 char name gets a 400 instead of a 500 on the INSERT.
        it('should register a 50-char username (column limit)', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 1, username: 'u'.repeat(50) }] });

            const res = await request(app)
                .post('/register')
                .send({ username: 'u'.repeat(50), password: 'password123' });

            expect(res.status).toBe(201);
        });

        it('should return 400 for a 51-char username (past the column limit)', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'u'.repeat(51), password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });

        // AUTH-009: registration requires the raised minimum password length.
        it('should return 400 for a 7-char password (below the 8-char minimum)', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'testuser', password: '1234567' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });
    });

    describe('GET /settings/registration', () => {
        it('should return enabled=true when setting row is missing', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/settings/registration');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ enabled: true });
        });

        it('should return enabled=false when setting is false', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'false' }] });

            const res = await request(app).get('/settings/registration');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ enabled: false });
        });
    });

    describe('GET /site-config', () => {
        it('exposes the password-change flag alongside access mode and registration', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] });
            (getPasswordChangeEnabled as jest.Mock).mockResolvedValueOnce(false);

            const res = await request(app).get('/site-config');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                accessMode: 'public',
                allowRegistration: true,
                passwordChangeEnabled: false,
            });
        });
    });

    describe('POST /login', () => {
        it('should return 400 for invalid login payload', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: '' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });

        it('should login successfully with correct credentials', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, username: 'testuser', password_hash: hashedPassword, role: 'user' }]
            });
            // Tier lookup (SUM over user_problem_rewards) — no rewards yet.
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ total_xp: '0' }]
            });

            const res = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Login successful');
            expect(res.body.user.username).toBe('testuser');
        });

        it('should include the XP-derived tier in the login response', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, username: 'testuser', password_hash: hashedPassword, role: 'user' }]
            });
            // 25000 XP -> level 16 -> Expert.
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ total_xp: '25000' }]
            });

            const res = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body.user.tier).toBe('Expert');
        });

        it('should still log the user in when the tier lookup fails', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, username: 'testuser', password_hash: hashedPassword, role: 'user' }]
            });
            (db.query as jest.Mock).mockRejectedValueOnce(new Error('rewards table gone'));

            const res = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body.user.username).toBe('testuser');
            expect(res.body.user.tier).toBeUndefined();
        });

        it('should return 401 with a neutral message for wrong password', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, username: 'testuser', password_hash: hashedPassword, role: 'user' }]
            });

            const res = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Invalid username or password');
        });

        it('should return 401 with the same neutral message if user not found', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/login')
                .send({ username: 'nonexistent', password: 'password123' });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Invalid username or password');
        });

        it('should not reveal whether the username exists', async () => {
            // Unknown username
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            const unknownRes = await request(app)
                .post('/login')
                .send({ username: 'nobody', password: 'password123' });

            // Known username, wrong password
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, username: 'testuser', password_hash: hashedPassword, role: 'user' }]
            });
            const wrongPassRes = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'wrongpassword' });

            expect(unknownRes.status).toBe(wrongPassRes.status);
            expect(unknownRes.body.message).toBe(wrongPassRes.body.message);
        });

        it('should return 429 while the account is locked out (AUTH-001)', async () => {
            // The per-account lockout is IP-independent: rotate the source IP
            // all you like, the username bucket is still full.
            for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
                recordLoginFailure('locked-user');
            }

            const res = await request(app)
                .post('/login')
                .set('X-Forwarded-For', '10.9.9.9') // a "fresh" spoofed IP
                .send({ username: 'locked-user', password: 'password123' });

            expect(res.status).toBe(429);
            expect(res.body.message).toBe('Too many failed login attempts. Please try again later.');
            // Locked before any DB lookup.
            expect(db.query).not.toHaveBeenCalled();
        });

        it('still locks out an admin-named account after repeated failures (no privileged exemption)', async () => {
            // The per-account lockout must never be weakened by the
            // staff/admin rate-limit exemptions: admin accounts are the most
            // attractive brute-force targets.
            const adminName = 'SiteAdmin';
            for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
                recordLoginFailure(adminName);
            }
            expect(require('../middleware/rateLimit').isLoginLocked(adminName)).toBe(true);

            const res = await request(app)
                .post('/login')
                .set('X-Forwarded-For', '10.8.8.8')
                .send({ username: adminName, password: 'password123' });

            expect(res.status).toBe(429);
            expect(res.body.message).toBe('Too many failed login attempts. Please try again later.');
            expect(db.query).not.toHaveBeenCalled();
        });
    });

    describe('POST /logout', () => {
        it('should logout successfully', async () => {
            const res = await request(app).post('/logout');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Logout successful');
        });
    });

    describe('PUT /profile/password (AUTH-004)', () => {
        // db is auto-mocked in this file, so db.withTransaction would be a
        // no-op stub. Re-wire it to the real transaction dance (connect ->
        // BEGIN/COMMIT/ROLLBACK) with the client's statements forwarded to
        // db.query, so queued per-test mocks keep working inside the
        // transaction body.
        const forwardTransactions = () => {
            (db.pool.connect as jest.Mock).mockImplementation(async () => ({
                query: (...args: unknown[]) => (db.query as jest.Mock)(...(args as [])),
                release: jest.fn(),
            }));
            (db.withTransaction as unknown as jest.Mock).mockImplementation(
                async (body: (client: { query: (...args: unknown[]) => unknown }) => Promise<unknown>) => {
                    const client = {
                        query: (...args: unknown[]) => (db.query as jest.Mock)(...(args as [])),
                    };
                    await client.query('BEGIN');
                    try {
                        const result = await body(client);
                        await client.query('COMMIT');
                        return result;
                    } catch (error) {
                        await client.query('ROLLBACK');
                        throw error;
                    }
                },
            );
        };

        const buildAppWithUser = (role: 'user' | 'staff' | 'admin' = 'user') => {
            const appWithUser = express();
            appWithUser.use(express.json());
            appWithUser.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
            }));
            appWithUser.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 7, username: 'changer', role, hasAvatar: false };
                next();
            });
            appWithUser.use('/', authRouter);
            appWithUser.use(errorHandler);
            return appWithUser;
        };

        it('should require authentication', async () => {
            const res = await request(app)
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Authentication required');
        });

        it('allows a regular user while password changes are enabled (default)', async () => {
            (getPasswordChangeEnabled as jest.Mock).mockResolvedValueOnce(true);
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ password_hash: hashedPassword }] });

            const res = await request(buildAppWithUser('user'))
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
        });

        it('returns 403 for a regular user when password changes are disabled', async () => {
            (getPasswordChangeEnabled as jest.Mock).mockResolvedValueOnce(false);

            const res = await request(buildAppWithUser('user'))
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Password changes are currently managed by administrators.');
            // Rejected before any password work happens.
            expect(db.query).not.toHaveBeenCalled();
        });

        it('returns 403 for a staff member when password changes are disabled', async () => {
            (getPasswordChangeEnabled as jest.Mock).mockResolvedValueOnce(false);

            const res = await request(buildAppWithUser('staff'))
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Password changes are currently managed by administrators.');
        });

        it('still lets an admin change their own password when disabled', async () => {
            (getPasswordChangeEnabled as jest.Mock).mockResolvedValueOnce(false);
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ password_hash: hashedPassword }] });

            const res = await request(buildAppWithUser('admin'))
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe(
                'Password changed successfully. Other sessions have been signed out.',
            );
        });

        it('lets an admin change their own password while enabled too', async () => {
            (getPasswordChangeEnabled as jest.Mock).mockResolvedValueOnce(true);
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ password_hash: hashedPassword }] });

            const res = await request(buildAppWithUser('admin'))
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
        });

        it('should reject a weak new password with 400', async () => {
            const res = await request(buildAppWithUser())
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'short' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });

        it('should reject a missing current password with 400', async () => {
            const res = await request(buildAppWithUser())
                .put('/profile/password')
                .send({ newPassword: 'newpassword45' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });

        it('should return 401 when the current password is wrong', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ password_hash: hashedPassword }]
            });

            const res = await request(buildAppWithUser())
                .put('/profile/password')
                .send({ currentPassword: 'wrongpassword', newPassword: 'newpassword45' });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Current password is incorrect');
        });

        it('should change the password and delete only the OTHER sessions', async () => {
            forwardTransactions();
            const hashedPassword = await bcrypt.hash('password123', 10);
            // 1. SELECT password_hash (once); BEGIN/UPDATE/DELETE/COMMIT fall
            //    through to the default resolved value.
            (db.query as jest.Mock)
                .mockResolvedValue({ rowCount: 1 })
                .mockResolvedValueOnce({ rows: [{ password_hash: hashedPassword }] });

            const res = await request(buildAppWithUser())
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe(
                'Password changed successfully. Other sessions have been signed out.',
            );

            const calls = (db.query as jest.Mock).mock.calls;
            // The new password must be stored bcrypt-hashed, never in plaintext.
            const update = calls.find(([sql]) => String(sql).startsWith('UPDATE users SET password_hash'));
            expect(update).toBeDefined();
            expect(String(update![1][0])).not.toBe('newpassword45');
            await expect(bcrypt.compare('newpassword45', String(update![1][0]))).resolves.toBe(true);
            expect(update![1][1]).toBe(7);

            // Session invalidation keeps the CURRENT session and drops the rest.
            const sessionDelete = calls.find(([sql]) => String(sql).startsWith('DELETE FROM user_sessions'));
            expect(sessionDelete![0]).toBe(
                "DELETE FROM user_sessions WHERE sess->>'userId' = $1 AND sid <> $2",
            );
            expect(sessionDelete![1][0]).toBe('7');
            expect(typeof sessionDelete![1][1]).toBe('string');

            const sqls = calls.map(([sql]) => String(sql));
            expect(sqls).toContain('BEGIN');
            expect(sqls).toContain('COMMIT');
        });

        it('should roll back the password update if session deletion fails', async () => {
            forwardTransactions();
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ password_hash: hashedPassword }] })
                .mockResolvedValueOnce({})   // BEGIN
                .mockResolvedValueOnce({})   // UPDATE users
                .mockRejectedValueOnce(new Error('session store gone')); // DELETE -> rollback

            const res = await request(buildAppWithUser())
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(500);

            const sqls = (db.query as jest.Mock).mock.calls.map(([sql]) => String(sql));
            expect(sqls).toContain('ROLLBACK');
            expect(sqls).not.toContain('COMMIT');
        });

        it('should return 404 when the user row vanished mid-request', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(buildAppWithUser())
                .put('/profile/password')
                .send({ currentPassword: 'password123', newPassword: 'newpassword45' });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Account not found.');
        });
    });

    describe('GET /me', () => {
        it('should return user info if authenticated', async () => {
            const res = await request(app).get('/me');
            expect(res.body.isAuthenticated).toBe(false);
        });

        it('should return authenticated user when req.user is present', async () => {
            const appWithUser = express();
            appWithUser.use(express.json());
            appWithUser.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
            }));
            appWithUser.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 1, username: 'tester', role: 'user', hasAvatar: true };
                next();
            });
            appWithUser.use('/', authRouter);
            // Tier lookup — no rewards yet.
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ total_xp: '0' }] });

            const res = await request(appWithUser).get('/me');
            expect(res.status).toBe(200);
            expect(res.body.isAuthenticated).toBe(true);
            expect(res.body.user.username).toBe('tester');
            expect(res.body.user.hasAvatar).toBe(true);
        });

        it('should include the XP-derived tier in the /me response', async () => {
            const appWithUser = express();
            appWithUser.use(express.json());
            appWithUser.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
            }));
            appWithUser.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 1, username: 'tester', role: 'user', hasAvatar: true };
                next();
            });
            appWithUser.use('/', authRouter);
            // 25000 XP -> level 16 -> Expert.
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ total_xp: '25000' }] });

            const res = await request(appWithUser).get('/me');
            expect(res.status).toBe(200);
            expect(res.body.user.tier).toBe('Expert');
        });

        it('should omit tier (not fail) when the progression lookup errors on /me', async () => {
            const appWithUser = express();
            appWithUser.use(express.json());
            appWithUser.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
            }));
            appWithUser.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 1, username: 'tester', role: 'user', hasAvatar: true };
                next();
            });
            appWithUser.use('/', authRouter);
            (db.query as jest.Mock).mockRejectedValueOnce(new Error('rewards table gone'));

            const res = await request(appWithUser).get('/me');
            expect(res.status).toBe(200);
            expect(res.body.isAuthenticated).toBe(true);
            expect(res.body.user.tier).toBeUndefined();
        });
    });
});
