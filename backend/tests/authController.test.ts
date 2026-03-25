import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import authRouter from '../controllers/authController';
import * as db from '../db';
import bcrypt from 'bcrypt';

// Mock the database
jest.mock('../db');

describe('Auth Controller', () => {
    let app: Express;

    beforeEach(() => {
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

            const res = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Login successful');
            expect(res.body.user.username).toBe('testuser');
        });

        it('should return 401 for wrong password', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, username: 'testuser', password_hash: hashedPassword, role: 'user' }]
            });

            const res = await request(app)
                .post('/login')
                .send({ username: 'testuser', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Wrong Password');
        });

        it('should return 401 if user not found', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/login')
                .send({ username: 'nonexistent', password: 'password123' });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('User not found');
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
                req.user = { id: 1, username: 'tester', role: 'user' };
                next();
            });
            appWithUser.use('/', authRouter);

            const res = await request(appWithUser).get('/me');
            expect(res.status).toBe(200);
            expect(res.body.isAuthenticated).toBe(true);
            expect(res.body.user.username).toBe('tester');
        });
    });
});
