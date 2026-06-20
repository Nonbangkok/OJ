import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import problemRouter from '../controllers/problemController';
import * as db from '../db';
import { processBatchUpload } from '../services/batchUploadService';

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
    diskUpload: {
        single: () => (req: Request, _res: Response, next: NextFunction) => {
            if (req.headers['x-test-has-file'] === '1') {
                req.file = { path: '/tmp/mock-problems.zip' } as Express.Multer.File;
            }
            next();
        }
    },
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

        it('should return 403 when hidden problem is requested by regular user', async () => {
            const appAsUser = express();
            appAsUser.use(express.json());
            appAsUser.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
            }));
            appAsUser.use((req: Request, _res: Response, next: NextFunction) => {
                if (req.session) {
                    req.session.userId = 2;
                    req.session.role = 'user';
                }
                next();
            });
            appAsUser.use('/', problemRouter);

            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{
                    id: 'P2',
                    title: 'Hidden',
                    author: 'A',
                    time_limit_ms: 1000,
                    memory_limit_mb: 256,
                    has_pdf: false,
                    is_visible: false,
                }]
            });

            const res = await request(appAsUser).get('/problems/P2');
            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Problem is hidden');
            expect(res.body.problemId).toBe('P2');
        });
    });

    describe('GET /problems/:id/pdf', () => {
        const visibleProblemRow = {
            id: 'P1',
            title: 'Problem 1',
            author: 'Author 1',
            time_limit_ms: 1000,
            memory_limit_mb: 256,
            has_pdf: true,
            is_visible: true,
            contest_id: null,
        };

        // Helper to build an app where the session role can be controlled per test.
        const buildAppAsRole = (role: string, userId: number) => {
            const roleApp = express();
            roleApp.use(express.json());
            roleApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
            }));
            roleApp.use((req: Request, _res: Response, next: NextFunction) => {
                if (req.session) {
                    req.session.userId = userId;
                    req.session.role = role;
                }
                next();
            });
            roleApp.use('/', problemRouter);
            return roleApp;
        };

        it('should return 404 when problem does not exist', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/problems/P404/pdf');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Problem PDF not found.');
        });

        it('should return the PDF for a visible problem', async () => {
            // 1. getProblemDetail
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [visibleProblemRow] });
            // 2. getProblemPdf
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ problem_pdf: Buffer.from('%PDF-1.4 mock') }] });

            const res = await request(app).get('/problems/P1/pdf');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('application/pdf');
        });

        it('should return 403 when a regular user requests a hidden problem PDF', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ ...visibleProblemRow, id: 'P2', is_visible: false }]
            });

            const res = await request(buildAppAsRole('user', 2)).get('/problems/P2/pdf');

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Problem is hidden');
            // Must not fall through to fetching the PDF buffer.
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        it('should return 403 when a regular user requests a contest problem PDF', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ ...visibleProblemRow, id: 'P3', is_visible: true, contest_id: 42 }]
            });

            const res = await request(buildAppAsRole('user', 2)).get('/problems/P3/pdf');

            expect(res.status).toBe(403);
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        it('should allow staff to fetch a hidden/contest problem PDF', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ ...visibleProblemRow, id: 'P3', is_visible: false, contest_id: 42 }]
            });
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ problem_pdf: Buffer.from('%PDF-1.4 mock') }] });

            const res = await request(buildAppAsRole('staff', 3)).get('/problems/P3/pdf');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('application/pdf');
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

    describe('GET /admin/problems/:id', () => {
        it('should return 404 for missing admin problem detail', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/admin/problems/NOPE');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Problem not found');
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

    describe('PUT /admin/problems/:id/visibility', () => {
        it('should update visibility successfully', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({
                rows: [{ id: 'P1', title: 'Problem 1', is_visible: false }]
            });

            const res = await request(app)
                .put('/admin/problems/P1/visibility')
                .send({ isVisible: false });

            expect(res.status).toBe(200);
            expect(res.body.problem.id).toBe('P1');
            expect(res.body.problem.is_visible).toBe(false);
        });

        it('should return 404 when updating visibility for missing problem', async () => {
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .put('/admin/problems/NOPE/visibility')
                .send({ isVisible: true });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Problem not found');
        });
    });

    describe('POST /admin/problems/batch-upload', () => {
        it('should return 400 if zip file is not uploaded', async () => {
            const res = await request(app).post('/admin/problems/batch-upload');

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('No zip file uploaded.');
        });

        it('should return 202 when batch upload starts', async () => {
            (processBatchUpload as jest.Mock).mockResolvedValueOnce({ added: [], skipped: [], errors: [] });
            const res = await request(app)
                .post('/admin/problems/batch-upload')
                .set('x-test-has-file', '1');

            expect(res.status).toBe(202);
            expect(res.body.progressId).toBeDefined();
            expect(res.body.message).toContain('Batch upload initiated');
        });
    });

    describe('POST /admin/problems/:id/upload', () => {
        it('should return 400 when no files are sent', async () => {
            const res = await request(app).post('/admin/problems/P1/upload');
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('No files uploaded.');
        });
    });
});
