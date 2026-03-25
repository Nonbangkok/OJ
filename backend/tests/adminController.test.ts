import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import adminRouter from '../controllers/adminController';
import * as db from '../db';

// Mock Dependencies
jest.mock('../db');
jest.mock('../middleware/auth', () => ({
    requireStaffOrAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    },
    requireAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    },
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.userId = 1;
        }
        next();
    }
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
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (req.session) {
                req.session.userId = 1;
                req.session.role = 'admin';
            }
            next();
        });
        app.use('/', adminRouter);
        jest.resetAllMocks();
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

    describe('GET /admin/users', () => {
        it('should return a list of non-root users', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 2, username: 'user1', role: 'user' }]
            });

            const res = await request(app).get('/admin/users');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].username).toBe('user1');
        });
    });
});
