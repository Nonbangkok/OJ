import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import contestRouter from '../controllers/contestController';
import * as db from '../db';
import { errorHandler } from '../middleware/errorHandler';

// Mock Dependencies
jest.mock('../db');
jest.mock('../services/problemMigration');
jest.mock('../middleware/auth', () => ({
    requireStaffOrAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    },
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.userId = 1;
            req.session.role = 'user';
        }
        next();
    }
}));

describe('Contest Controller', () => {
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
        app.use('/', contestRouter);
        app.use(errorHandler);
        jest.resetAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('GET /contests', () => {
        it('should return a list of contests based on visibility', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, title: 'Contest 1', is_visible: true }]
            });

            const res = await request(app).get('/contests');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].title).toBe('Contest 1');
        });
    });

    describe('GET /contests/:id', () => {
        it('should fetch specific contest details based on availability', async () => {
            // Because our test app sets userId = 1 in the session middleware, 3 queries run:
            // 1. Contest details
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, title: 'Contest 1', status: 'running' }]
            });
            // 2. Participant check
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ 1: 1 }] // user is participating
            });
            // 3. Problems query (because status is running)
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 'P1', title: 'Problem 1' }]
            });

            const res = await request(app).get('/contests/1');

            expect(res.status).toBe(200);
            expect(res.body.title).toBe('Contest 1');
            expect(res.body.problems.length).toBe(1);
        });

        it('should return 404 if contest not found', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [] // Empty rows means not found
            });
            const res = await request(app).get('/contests/999');
            expect(res.status).toBe(404);
        });
    });

    describe('POST /contests/:id/join', () => {
        it('should return 404 when contest does not exist', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).post('/contests/999/join');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Contest not found');
        });

        it('should return 400 when contest already ended', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, end_time: new Date(Date.now() - 60_000) }]
            });

            const res = await request(app).post('/contests/1/join');

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Cannot join contest that has already ended');
        });

        it('should return 400 when user already joined', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({
                    rows: [{ id: 1, end_time: new Date(Date.now() + 60_000) }]
                })
                .mockResolvedValueOnce({ rowCount: 0 });

            const res = await request(app).post('/contests/1/join');

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Already joined this contest');
        });

        it('should join contest successfully', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({
                    rows: [{ id: 1, end_time: new Date(Date.now() + 60_000) }]
                })
                .mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app).post('/contests/1/join');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Successfully joined contest');
        });
    });

    describe('POST /admin/contests', () => {
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
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Insert
                .mockResolvedValue({ rowCount: 1 }); // For all subsequent problem checks/updates

            const res = await request(app).post('/admin/contests').send(payload);

            expect(res.status).toBe(201);
            expect(res.body.id).toBe(1);
        });

        it('should return 400 when endTime is before startTime', async () => {
            const payload = {
                title: 'Invalid Contest',
                description: 'Description',
                startTime: '2025-01-02T00:00:00Z',
                endTime: '2025-01-01T00:00:00Z'
            };

            const res = await request(app).post('/admin/contests').send(payload);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('End time must be after start time');
        });
    });

    describe('GET /admin/contests', () => {
        it('should return 200 and a list of contests for admin', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [
                    {
                        id: 1,
                        title: 'Admin Contest',
                        participant_count: '5',
                        problem_count: '3',
                        status: 'scheduled'
                    },
                    {
                        id: 2,
                        title: 'Staff Contest',
                        participant_count: '14',
                        problem_count: '7',
                        status: 'running'
                    }
                ]
            });

            const res = await request(app).get('/admin/contests');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
            expect(res.body[0].title).toBe('Admin Contest');
            expect(res.body[0].participant_count).toBe('5');
            expect(res.body[0].problem_count).toBe('3');
            expect(res.body[0].status).toBe('scheduled');
            expect(res.body[1].title).toBe('Staff Contest');
            expect(res.body[1].participant_count).toBe('14');
            expect(res.body[1].problem_count).toBe('7');
            expect(res.body[1].status).toBe('running');
        });
    });
});
