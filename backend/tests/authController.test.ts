import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import authRouter from '../controllers/authController';
import * as db from '../db';
import bcrypt from 'bcrypt';
import { RATE_LIMIT_CONFIG } from '../constants';
import { recordLoginFailure, resetLoginFailureTracker } from '../middleware/rateLimit';

// Mock the database
jest.mock('../db');

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
    });

    describe('POST /logout', () => {
        it('should logout successfully', async () => {
            const res = await request(app).post('/logout');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Logout successful');
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
