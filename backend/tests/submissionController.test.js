const request = require('supertest');
const express = require('express');
const session = require('express-session');
const submissionRouter = require('../controllers/submissionController');
const db = require('../db');
const { processSubmission, processContestSubmission } = require('../services/submissionService');

// Mock dependencies
jest.mock('../db');
jest.mock('../services/submissionService');
jest.mock('../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.session.userId = 1;
        req.session.role = 'user';
        next();
    }
}));

describe('Submission Controller', () => {
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
            req.session.role = 'user';
            next();
        });
        app.use('/', submissionRouter);
        jest.clearAllMocks();
    });

    describe('POST /submit', () => {
        it('should return 400 if language is not cpp', async () => {
            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'python', code: 'print("hello")' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Only C++ is supported.');
        });

        it('should accept a valid regular submission', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // Problem exists check
            db.query.mockResolvedValueOnce({ rows: [{ id: 101 }] }); // Insertion result

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'cpp', code: '#include <iostream>' });

            expect(res.status).toBe(202);
            expect(res.body.submissionId).toBe(101);
            expect(processSubmission).toHaveBeenCalledWith(101);
        });

        it('should return 400 if problem is not available', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // Problem not found or invisible

            const res = await request(app)
                .post('/submit')
                .send({ problemId: 'P1', language: 'cpp', code: '#include <iostream>' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Problem is not available for submission.');
        });
    });

    describe('GET /submissions', () => {
        it('should return a list of submissions', async () => {
            const mockSubmissions = [
                { id: 101, username: 'testuser', problem_id: 'P1', overall_status: 'Accepted' }
            ];
            db.query.mockResolvedValueOnce({ rows: mockSubmissions });

            const res = await request(app).get('/submissions');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockSubmissions);
        });
    });
});
