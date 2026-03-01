const request = require('supertest');
const express = require('express');
const session = require('express-session');
const adminRouter = require('../controllers/adminController');
const db = require('../db');
const { requireStaffOrAdmin } = require('../middleware/auth');

// Mock Dependencies
jest.mock('../db');
jest.mock('../middleware/auth', () => ({
    requireStaffOrAdmin: (req, res, next) => {
        req.session.role = 'admin';
        next();
    },
    requireAdmin: (req, res, next) => {
        req.session.role = 'admin';
        next();
    },
    requireAuth: (req, res, next) => {
        req.session.userId = 1;
        next();
    }
}));

describe('Admin Controller', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        app.use((req, res, next) => {
            req.session.userId = 1;
            req.session.role = 'admin';
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
            db.query.mockResolvedValueOnce({
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
            db.query.mockResolvedValue({ rowCount: 1 }); // Mock map updates

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
            db.query.mockResolvedValueOnce({
                rows: [{ id: 2, username: 'user1', role: 'user' }]
            });

            const res = await request(app).get('/admin/users');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].username).toBe('user1');
        });
    });
});
