import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import problemRouter from '../controllers/problemController';
import * as db from '../db';

// Mock dependencies
jest.mock('../db');
jest.mock('../middleware/auth', () => ({
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.userId = 1;
        }
        next();
    },
    requireAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    },
    requireStaffOrAdmin: (req: Request, res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.role = 'admin';
        }
        next();
    }
}));
jest.mock('unzipper', () => ({}));
jest.mock('archiver', () => ({}));
jest.mock('../middleware/upload', () => ({
    diskUpload: { single: () => (req: Request, res: Response, next: NextFunction) => next() },
    memoryUpload: { fields: () => (req: Request, res: Response, next: NextFunction) => next() }
}));
jest.mock('../services/batchUploadService', () => ({
    processBatchUpload: jest.fn()
}));

describe('Problem Controller', () => {
    let app: Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        // We need to set the session role for tests that check it manually in the controller
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (req.session) {
                req.session.userId = 1;
                req.session.role = 'admin';
            }
            next();
        });
        app.use('/', problemRouter);
        jest.resetAllMocks();
    });

    afterAll(() => {
        // Clear anything that might keep the event loop alive
        jest.restoreAllMocks();
    });

    describe('GET /problems', () => {
        it('should return a list of visible problems', async () => {
            const mockProblems = [
                { id: 'P1', title: 'Problem 1', author: 'Author 1' },
                { id: 'P2', title: 'Problem 2', author: 'Author 2' }
            ];
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: mockProblems });

            const res = await request(app).get('/problems');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockProblems);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT id, title, author FROM problems WHERE is_visible = true AND contest_id IS NULL ORDER BY id'
            );
        });
    });

    describe('GET /problems/:id', () => {
        it('should return problem details if visible', async () => {
            const mockProblem = {
                id: 'P1',
                title: 'Problem 1',
                author: 'Author 1',
                time_limit_ms: 1000,
                memory_limit_mb: 256,
                has_pdf: true,
                is_visible: true
            };
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [mockProblem] });

            const res = await request(app).get('/problems/P1');

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('P1');
        });

        it('should return 404 if problem not found', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/problems/NONEXISTENT');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Problem not found');
        });
    });

    describe('POST /admin/problems', () => {
        it('should create a new problem successfully', async () => {
            const newProblem = {
                id: 'P3',
                title: 'Problem 3',
                author: 'Author 3',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            };
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [newProblem] });

            const res = await request(app)
                .post('/admin/problems')
                .send(newProblem);

            expect(res.status).toBe(201);
            expect(res.body.id).toBe('P3');
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO problems'),
                expect.arrayContaining(['P3', 'Problem 3'])
            );
        });

        it('should return 400 for invalid input', async () => {
            const invalidProblem = { id: '', title: '' }; // Missing fields

            const res = await request(app)
                .post('/admin/problems')
                .send(invalidProblem);

            expect(res.status).toBe(400);
            expect(res.body.errors).toBeDefined();
        });
    });

    describe('DELETE /admin/problems/:id', () => {
        it('should delete a problem and its related data', async () => {
            // The route makes 5 sequential queries:
            // 1. DELETE FROM submissions
            // 2. DELETE FROM testcases
            // 3. DELETE FROM contest_problems
            // 4. DELETE FROM contest_submissions
            // 5. DELETE FROM problems RETURNING id
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rowCount: 1 }) // submissions
                .mockResolvedValueOnce({ rowCount: 1 }) // testcases
                .mockResolvedValueOnce({ rowCount: 1 }) // contest_problems
                .mockResolvedValueOnce({ rowCount: 1 }) // contest_submissions
                .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'P1' }] }); // problems

            const res = await request(app).delete('/admin/problems/P1');

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('deleted successfully');
            // Should have called delete for submissions, testcases, etc.
            expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM submissions'), ['P1']);
        });
    });
});
