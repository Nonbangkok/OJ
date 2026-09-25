import request from 'supertest';
import express, { Express } from 'express';
import session from 'express-session';
import problemRouter from '../controllers/problemController';
import { errorHandler } from '../middleware/errorHandler';
import * as db from '../db';
import { TESTCASE_VIEWER_CONFIG } from '../constants';

// Mock only the DB: the auth middleware is deliberately NOT mocked so the
// requireAuth/requireStaffOrAdmin chain is exercised for real (the same
// pattern as rejudgeController.test.ts — the 401/403 cases below depend on it).
jest.mock('../db');
jest.mock('../services/siteSettingsService', () => ({
    getSiteAccessMode: jest.fn().mockResolvedValue('public'),
    updateSiteAccessMode: jest.fn(),
    resetSiteAccessModeCache: jest.fn(),
}));
jest.mock('unzipper', () => ({}));
jest.mock('archiver', () => ({}));
jest.mock('../middleware/upload', () => ({
    diskUpload: { single: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() },
    memoryUpload: { fields: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() },
}));

describe('GET /admin/problems/:id/testcases', () => {
    const buildApp = (role: string | null): Express => {
        const server = express();
        server.use(express.json());
        server.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
        if (role !== null) {
            server.use((req, _res, next) => {
                req.user = { id: 1, username: 'u1', role: role as 'admin', hasAvatar: false };
                next();
            });
        }
        server.use('/', problemRouter);
        server.use(errorHandler);
        return server;
    };

    /** db.query stub answering by SQL shape. */
    const stubQueries = (handlers: Array<[string, unknown]>): void => {
        (db.query as jest.Mock).mockImplementation(async (text: string) => {
            for (const [needle, value] of handlers) {
                if (text.includes(needle)) return value;
            }
            return { rows: [], rowCount: 0 };
        });
    };

    beforeEach(() => {
        jest.resetAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('auth', () => {
        it('returns 401 for guests', async () => {
            const app = buildApp(null);
            const res = await request(app).get('/admin/problems/P1/testcases');
            expect(res.status).toBe(401);
            expect(db.query).not.toHaveBeenCalled();
        });

        it('returns 403 for plain users', async () => {
            const app = buildApp('user');
            const res = await request(app).get('/admin/problems/P1/testcases');
            expect(res.status).toBe(403);
            expect(db.query).not.toHaveBeenCalled();
        });

        it.each(['staff', 'admin'])('returns 200 for %s', async (role) => {
            const app = buildApp(role);
            stubQueries([
                ['SELECT id FROM problems', { rows: [{ id: 'P1' }] }],
                ['OCTET_LENGTH(input_data::bytea)', { rows: [{ case_number: 1, input_bytes: 3, output_bytes: 5 }] }],
            ]);
            const res = await request(app).get('/admin/problems/P1/testcases');
            expect(res.status).toBe(200);
        });
    });

    describe('metadata list (no caseNumber)', () => {
        it('returns case metadata with sizes and a total, ordered by case_number', async () => {
            const rows = [
                { case_number: 1, input_bytes: 11, output_bytes: 22 },
                { case_number: 2, input_bytes: 0, output_bytes: 4 },
            ];
            stubQueries([
                ['SELECT id FROM problems', { rows: [{ id: 'P1' }] }],
                ['OCTET_LENGTH(input_data::bytea)', { rows }],
            ]);
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                testcases: [
                    { case_number: 1, input_bytes: 11, output_bytes: 22 },
                    { case_number: 2, input_bytes: 0, output_bytes: 4 },
                ],
                total: 2,
            });
            // Content columns must never be selected for the list.
            expect(db.query).toHaveBeenCalledWith(
                expect.not.stringContaining('input_data,'),
                ['P1'],
            );
        });

        it('returns an empty list for a problem with no testcases', async () => {
            stubQueries([
                ['SELECT id FROM problems', { rows: [{ id: 'P1' }] }],
                ['OCTET_LENGTH(input_data::bytea)', { rows: [] }],
            ]);
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ testcases: [], total: 0 });
        });
    });

    describe('single case (?caseNumber=N)', () => {
        it('returns the full case content', async () => {
            stubQueries([
                ['SELECT id FROM problems', { rows: [{ id: 'P1' }] }],
                ['case_number = $2', { rows: [{ case_number: 3, input_data: '1 2 3\n', output_data: '6\n' }] }],
            ]);
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases?caseNumber=3');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                caseNumber: 3,
                input: { bytes: 6, truncated: false, content: '1 2 3\n' },
                output: { bytes: 2, truncated: false, content: '6\n' },
            });
        });

        it('truncates oversized content and reports the true byte size', async () => {
            const big = 'a'.repeat(TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES + 4096);
            stubQueries([
                ['SELECT id FROM problems', { rows: [{ id: 'P1' }] }],
                ['case_number = $2', { rows: [{ case_number: 1, input_data: big, output_data: 'ok' }] }],
            ]);
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases?caseNumber=1');

            expect(res.status).toBe(200);
            expect(res.body.caseNumber).toBe(1);
            expect(res.body.input.truncated).toBe(true);
            expect(res.body.input.bytes).toBe(TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES + 4096);
            expect(res.body.input.content.length).toBe(TESTCASE_VIEWER_CONFIG.MAX_CASE_BYTES);
            // The small side is untouched.
            expect(res.body.output).toEqual({ bytes: 2, truncated: false, content: 'ok' });
        });

        it('returns 404 for a missing case number', async () => {
            stubQueries([
                ['SELECT id FROM problems', { rows: [{ id: 'P1' }] }],
                ['case_number = $2', { rows: [] }],
            ]);
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases?caseNumber=99');

            expect(res.status).toBe(404);
            expect(res.body.message).toContain('99');
        });
    });

    describe('404s and validation', () => {
        it('returns 404 when the problem does not exist (list)', async () => {
            stubQueries([['SELECT id FROM problems', { rows: [] }]]);
            const res = await request(buildApp('admin')).get('/admin/problems/NOPE/testcases');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Problem not found');
        });

        it('returns 404 when the problem does not exist (caseNumber still validated first)', async () => {
            stubQueries([['SELECT id FROM problems', { rows: [] }]]);
            const res = await request(buildApp('admin')).get('/admin/problems/NOPE/testcases?caseNumber=1');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Problem not found');
        });

        it('rejects non-positive caseNumber with 400', async () => {
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases?caseNumber=0');
            expect(res.status).toBe(400);
            expect(res.body.errors).toBeDefined();
        });

        it('rejects unknown query params with 400', async () => {
            const res = await request(buildApp('admin')).get('/admin/problems/P1/testcases?drop=true');
            expect(res.status).toBe(400);
        });

        it('rejects a whitespace-only problem id with 400', async () => {
            const res = await request(buildApp('admin')).get('/admin/problems/%20/testcases');
            expect(res.status).toBe(400);
        });
    });
});
