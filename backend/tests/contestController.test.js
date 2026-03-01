const request = require('supertest');
const express = require('express');
const session = require('express-session');
const contestRouter = require('../controllers/contestController');
const db = require('../db');
const { requireStaffOrAdmin, requireAuth } = require('../middleware/auth');

// Mock Dependencies
jest.mock('../db');
jest.mock('../services/problemMigration');
jest.mock('../middleware/auth', () => ({
    requireStaffOrAdmin: (req, res, next) => {
        req.session.role = 'admin';
        next();
    },
    requireAuth: (req, res, next) => {
        req.session.userId = 1;
        req.session.role = 'user';
        next();
    }
}));

describe('Contest Controller', () => {
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
        app.use('/', contestRouter);
        jest.resetAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('GET /', () => {
        it('should return a list of contests based on visibility', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ id: 1, title: 'Contest 1', is_visible: true }]
            });

            const res = await request(app).get('/');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].title).toBe('Contest 1');
        });
    });

    describe('GET /contests/:id', () => {
        it('should fetch specific contest details based on availability', async () => {
            // Because our test app sets userId = 1 in the session middleware, 3 queries run:
            // 1. Contest details
            db.query.mockResolvedValueOnce({
                rows: [{ id: 1, title: 'Contest 1', status: 'running' }]
            });
            // 2. Participant check
            db.query.mockResolvedValueOnce({
                rows: [{ 1: 1 }] // user is participating
            });
            // 3. Problems query (because status is running)
            db.query.mockResolvedValueOnce({
                rows: [{ id: 'P1', title: 'Problem 1' }]
            });

            const res = await request(app).get('/1');

            expect(res.status).toBe(200);
            expect(res.body.title).toBe('Contest 1');
            expect(res.body.problems.length).toBe(1);
        });

        it('should return 404 if contest not found', async () => {
            db.query.mockResolvedValueOnce({
                rows: [] // Empty rows means not found
            });
            const res = await request(app).get('/999');
            expect(res.status).toBe(404);
        });
    });

    describe('POST /', () => {
        it('should create a new contest and assign problems', async () => {
            const payload = {
                title: 'New Contest',
                description: 'Description',
                startTime: '2025-01-01T00:00:00Z',
                endTime: '2025-01-02T00:00:00Z',
                is_visible: true,
                problems: ['P1', 'P2']
            };

            // 1. insert contest, 2. check P1, 3. update P1, 4. add contest_prob, 5. check P2, 6. update P2, 7. add contest_prob
            db.query
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Insert
                .mockResolvedValue({ rowCount: 1 }); // For all subsequent problem checks/updates

            const res = await request(app).post('/').send(payload);

            expect(res.status).toBe(201);
            expect(res.body.id).toBe(1);
        });
    });
});
