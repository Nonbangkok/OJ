import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import submissionRouter from '../controllers/submissionController';
import * as db from '../db';
import { processContestSubmission, processSubmission } from '../services/submissionService';
import { errorHandler } from '../middleware/errorHandler';

// Mock dependencies
jest.mock('../db');
jest.mock('../services/siteSettingsService', () => ({
    getSiteAccessMode: jest.fn().mockResolvedValue('public'),
    updateSiteAccessMode: jest.fn(),
    resetSiteAccessModeCache: jest.fn(),
}));
jest.mock('../services/submissionService');
jest.mock('../middleware/auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        // Keep an explicitly staged identity (staff/admin apps below) instead
        // of stomping it — the default stays a regular user. Handlers read
        // req.user (post-revalidation), not raw session fields.
        req.user = req.user ?? { id: 1, username: 'user1', role: 'user', hasAvatar: false };
        next();
    },
}));

describe('Submission Controller', () => {
    let app: Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        // Handlers read the user context (req.user), not raw session fields.
        app.use((req: Request, _res: Response, next: NextFunction) => {
            req.user = { id: 1, username: 'user1', role: 'user', hasAvatar: false };
            next();
        });
        app.use('/', submissionRouter);
        app.use(errorHandler);
        jest.clearAllMocks();
    });

    describe('POST /submit', () => {
        it('should return 400 for invalid payload (zod validation)', async () => {
            const res = await request(app)
                .post('/submit')
                .send({ problemId: '', language: 'cpp', code: '' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
            expect(Array.isArray(res.body.errors)).toBe(true);
        });

        it('should return 400 if language is not supported', async () => {
            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'java', code: 'System.out.println(1);' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });

        it('should accept a python submission', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // Problem exists check
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 303 }] }); // Insertion result

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'python', code: 'print("hello")' });

            expect(res.status).toBe(202);
            expect(res.body.submissionId).toBe(303);
            expect(processSubmission).toHaveBeenCalledWith(303);
        });

        it('should accept a valid regular submission', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // Problem exists check
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 101 }] }); // Insertion result

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'cpp', code: '#include <iostream>' });

            expect(res.status).toBe(202);
            expect(res.body.submissionId).toBe(101);
            expect(processSubmission).toHaveBeenCalledWith(101);
        });

        it('should return 400 if problem is not available', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Problem not found or invisible

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'cpp', code: '#include <iostream>' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Problem is not available for submission.');
        });

        it('should accept a valid contest submission and queue contest judge', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({
                    rows: [{ id: 1, status: 'running', start_time: new Date(Date.now() - 3600_000), end_time: new Date(Date.now() + 3600_000) }]
                }) // contest exists + running
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // participant check
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // problem in contest
                .mockResolvedValueOnce({ rows: [{ id: 202 }] }); // insert contest submission

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'CP1', language: 'cpp', code: '#include <iostream>', contestId: '1' });

            expect(res.status).toBe(202);
            expect(res.body.submissionId).toBe(202);
            expect(res.body.isContestSubmission).toBe(true);
            expect(processContestSubmission).toHaveBeenCalledWith(202);
            expect(processSubmission).not.toHaveBeenCalled();
        });

        it('should return 403 when user is not a contest participant', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({
                    rows: [{ id: 1, status: 'running', start_time: new Date(Date.now() - 3600_000), end_time: new Date(Date.now() + 3600_000) }]
                })
                .mockResolvedValueOnce({ rows: [] }); // participant check

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'CP1', language: 'cpp', code: '#include <iostream>', contestId: '1' });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('You must join the contest before submitting.');
        });

        it('should return 400 when contest is not running', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 1, status: 'scheduled', start_time: new Date(Date.now() - 3600_000), end_time: new Date(Date.now() + 3600_000) }]
            });

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'CP1', language: 'cpp', code: '#include <iostream>', contestId: '1' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Contest is not running');
        });
    });

    describe('GET /submissions', () => {
        it('should return a list of submissions', async () => {
            const mockSubmissions = [
                { id: 101, username: 'testuser', problem_id: 'P1', overall_status: 'Accepted' }
            ];
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: mockSubmissions });

            const res = await request(app).get('/submissions');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockSubmissions);
            // PROBLEM-001: non-staff feed filters hidden/contest problems.
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('p.is_visible = true AND p.contest_id IS NULL'),
                [],
            );
        });

        it('should return filtered submissions for mine filter', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 301, username: 'u1', problem_id: 'P1', overall_status: 'Accepted' }]
            });

            const res = await request(app).get('/submissions?filter=mine');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
        });

        it('should reject a contest feed for a non-participant (SUB-002)', async () => {
            // 1. contest exists, 2. participant check -> not a participant
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/submissions?contestId=1');

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('You must join this contest to view its submissions.');
        });

        it('should return 404 for a contest feed when the contest does not exist', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/submissions?contestId=999');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Contest not found.');
        });

        it('should return a contest feed for a participant', async () => {
            const mockRows = [{ id: 5, username: 'u1', problem_id: 'CP1' }];
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] }) // contest exists
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // participant
                .mockResolvedValueOnce({ rows: mockRows }); // feed rows

            const res = await request(app).get('/submissions?contestId=1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockRows);
        });

        it('should return 200 for staff on a contest feed without a participant row', async () => {
            const staffApp = express();
            staffApp.use(express.json());
            staffApp.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
            staffApp.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 1, username: 'user1', role: 'staff', hasAvatar: false };
                next();
            });
            staffApp.use('/', submissionRouter);
            staffApp.use(errorHandler);

            const mockRows = [{ id: 5, username: 'u1', problem_id: 'CP1' }];
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows: mockRows });

            const res = await request(staffApp).get('/submissions?contestId=1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockRows);
        });
    });

    describe('GET /search/problems', () => {
        it('should return empty array when q is missing', async () => {
            const res = await request(app).get('/search/problems');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
            expect(db.query).not.toHaveBeenCalled();
        });

        it('restricts the default search to visible, non-contest problems for regular users (PROBLEM-001)', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 'P1', title: 'Public Problem' }],
            });

            const res = await request(app).get('/search/problems?q=prob');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: 'P1', title: 'Public Problem' }]);
            const [sql, params] = (db.query as jest.Mock).mock.calls[0];
            expect(sql).toContain('is_visible = true AND contest_id IS NULL');
            expect(params).toEqual(['%prob%']);
        });

        it('searches the full catalog for staff (PROBLEM-001)', async () => {
            const staffApp = express();
            staffApp.use(express.json());
            staffApp.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
            staffApp.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 1, username: 'user1', role: 'staff', hasAvatar: false };
                next();
            });
            staffApp.use('/', submissionRouter);
            staffApp.use(errorHandler);

            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 'DRAFT1', title: 'Draft' }],
            });

            const res = await request(staffApp).get('/search/problems?q=dr');

            expect(res.status).toBe(200);
            const [sql] = (db.query as jest.Mock).mock.calls[0];
            expect(sql).not.toContain('is_visible = true');
            expect(res.body).toEqual([{ id: 'DRAFT1', title: 'Draft' }]);
        });

        it('hides contest-problem search from non-participants (PROBLEM-001)', async () => {
            // 1. contest exists (status running), 2. participant check -> no.
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/search/problems?q=apl&contestId=1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
            // Only the contest + participant lookups ran — no problem query.
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        it('returns contest problems to a participant', async () => {
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] }) // contest exists
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // participant
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] });

            const res = await request(app).get('/search/problems?q=apl&contestId=1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
        });

        it('returns contest problems to staff without a participant row', async () => {
            const staffApp = express();
            staffApp.use(express.json());
            staffApp.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
            staffApp.use((req: Request, _res: Response, next: NextFunction) => {
                req.user = { id: 1, username: 'user1', role: 'admin', hasAvatar: false };
                next();
            });
            staffApp.use('/', submissionRouter);
            staffApp.use(errorHandler);

            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ status: 'finished' }] }) // contest exists
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] }); // snapshot search

            const res = await request(staffApp).get('/search/problems?q=apl&contestId=1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
        });
    });

    describe('GET /submissions/:id', () => {
        it('should return 403 when user is not owner and not staff/admin', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 10, user_id: 99, username: 'other-user' }]
            });

            const res = await request(app).get('/submissions/10');

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('You are not authorized to view this submission.');
        });
    });

    describe('GET /scoreboard', () => {
        it('should return global scoreboard', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ username: 'u1', total_score: '100', problems_solved: '1', last_score_improvement_time: null }]
            });

            const res = await request(app).get('/scoreboard');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].username).toBe('u1');
        });
    });
});
