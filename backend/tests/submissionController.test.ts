import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import submissionRouter from '../controllers/submissionController';
import * as db from '../db';
import { processContestSubmission, processSubmission } from '../services/submissionService';
import { errorHandler } from '../middleware/errorHandler';

// Mock dependencies
jest.mock('../db');
jest.mock('../services/submissionService');
jest.mock('../middleware/auth', () => ({
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.userId = 1;
            req.session.role = 'user';
        }
        next();
    }
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
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (req.session) {
                req.session.userId = 1;
                req.session.role = 'user';
            }
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

        it('should return 400 if language is not cpp', async () => {
            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'python', code: 'print("hello")' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Only C++ is supported.');
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
                    rows: [{ id: 1, status: 'running', start_time: new Date(), end_time: new Date() }]
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
                    rows: [{ id: 1, status: 'running', start_time: new Date(), end_time: new Date() }]
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
                rows: [{ id: 1, status: 'scheduled', start_time: new Date(), end_time: new Date() }]
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
        });

        it('should return filtered submissions for mine filter', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 301, username: 'u1', problem_id: 'P1', overall_status: 'Accepted' }]
            });

            const res = await request(app).get('/submissions?filter=mine');

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
        });
    });

    describe('GET /search/problems', () => {
        it('should return empty array when q is missing', async () => {
            const res = await request(app).get('/search/problems');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
            expect(db.query).not.toHaveBeenCalled();
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
