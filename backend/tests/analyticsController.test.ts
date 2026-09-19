import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import analyticsRouter from '../controllers/analyticsController';
import * as analyticsService from '../services/analyticsQueryService';

// Mock dependencies — same pattern as adminController.test.ts
jest.mock('../db');
jest.mock('../services/analyticsQueryService', () => ({
    getOverviewAnalytics: jest.fn().mockResolvedValue({ kpis: {}, dailySeries: [] }),
    listUsersForAnalytics: jest.fn().mockResolvedValue([]),
    listProblemsForAnalytics: jest.fn().mockResolvedValue([]),
    getUserAnalytics: jest.fn().mockResolvedValue(null),
    getProblemAnalytics: jest.fn().mockResolvedValue(null),
    getContestAnalytics: jest.fn().mockResolvedValue(null),
}));

const mockGetOverviewAnalytics = analyticsService.getOverviewAnalytics as jest.MockedFunction<typeof analyticsService.getOverviewAnalytics>;
const mockListUsersForAnalytics = analyticsService.listUsersForAnalytics as jest.MockedFunction<typeof analyticsService.listUsersForAnalytics>;
const mockGetUserAnalytics = analyticsService.getUserAnalytics as jest.MockedFunction<typeof analyticsService.getUserAnalytics>;
const mockGetProblemAnalytics = analyticsService.getProblemAnalytics as jest.MockedFunction<typeof analyticsService.getProblemAnalytics>;
const mockGetContestAnalytics = analyticsService.getContestAnalytics as jest.MockedFunction<typeof analyticsService.getContestAnalytics>;
const mockListProblemsForAnalytics = analyticsService.listProblemsForAnalytics as jest.MockedFunction<typeof analyticsService.listProblemsForAnalytics>;

const buildApp = (forbidden = false): Express => {
    const app = express();
    app.use(express.json());
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
    }));
    app.use((req: Request, _res: Response, next: NextFunction) => {
        if (req.session) {
            req.session.userId = 1;
            // requireStaffOrAdmin reads req.session.role; 'staff' exercises the
            // allowed path, 'user' the rejected one (no middleware mocking needed).
            req.session.role = forbidden ? 'user' : 'staff';
        }
        next();
    });
    app.use('/', analyticsRouter);
    return app;
};

describe('Analytics Controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /analytics/overview', () => {
        it('defaults days to 30 and returns the service payload', async () => {
            mockGetOverviewAnalytics.mockResolvedValueOnce({
                kpis: { submissions: { current: 1, previous: 0 } },
                dailySeries: [],
                verdictBreakdown: [],
                topProblems: [],
                topSubmitters: [],
                contestStats: [],
            } as never);

            const res = await request(buildApp()).get('/analytics/overview');

            expect(res.status).toBe(200);
            expect(res.body.kpis.submissions).toEqual({ current: 1, previous: 0 });
            expect(mockGetOverviewAnalytics).toHaveBeenCalledWith(30);
        });

        it('accepts days=7 and passes it through', async () => {
            mockGetOverviewAnalytics.mockResolvedValueOnce({} as never);

            const res = await request(buildApp()).get('/analytics/overview?days=7');

            expect(res.status).toBe(200);
            expect(mockGetOverviewAnalytics).toHaveBeenCalledWith(7);
        });

        it('accepts days=0 as all-time and passes it through', async () => {
            mockGetOverviewAnalytics.mockResolvedValueOnce({} as never);

            const res = await request(buildApp()).get('/analytics/overview?days=0');

            expect(res.status).toBe(200);
            expect(mockGetOverviewAnalytics).toHaveBeenCalledWith(0);
        });

        it('rejects days outside 0/7/30/90 with 400', async () => {
            const res = await request(buildApp()).get('/analytics/overview?days=45');

            expect(res.status).toBe(400);
            expect(mockGetOverviewAnalytics).not.toHaveBeenCalled();
        });
    });

    describe('GET /analytics/users', () => {
        it('passes search/limit/offset to the service and returns rows', async () => {
            mockListUsersForAnalytics.mockResolvedValueOnce([{
                userId: 2, username: 'bob', role: 'user', submissions: 20, solved: 4, acRate: 0.5, lastActive: null,
            }] as never);

            const res = await request(buildApp()).get('/analytics/users?search=bo&limit=25&offset=50');

            expect(res.status).toBe(200);
            expect(mockListUsersForAnalytics).toHaveBeenCalledWith('bo', 25, 50, 'submissions', 'desc');
            expect(res.body.users[0].username).toBe('bob');
        });

        it('rejects limit above 100 with 400', async () => {
            const res = await request(buildApp()).get('/analytics/users?limit=500');

            expect(res.status).toBe(400);
            expect(mockListUsersForAnalytics).not.toHaveBeenCalled();
        });

        it('applies defaults when no query params are sent', async () => {
            mockListUsersForAnalytics.mockResolvedValueOnce([] as never);

            const res = await request(buildApp()).get('/analytics/users');

            expect(res.status).toBe(200);
            // Regression: defaults must be concrete values, not undefined —
            // undefined search previously produced a NULL ILIKE pattern that
            // matched no users at all.
            expect(mockListUsersForAnalytics).toHaveBeenCalledWith('', 50, 0, 'submissions', 'desc');
        });
    });

    describe('GET /analytics/problems', () => {
        it('passes search/sort to the service and returns rows', async () => {
            mockListProblemsForAnalytics.mockResolvedValueOnce([{
                problemId: 'aplusb', title: 'A Plus B', category: 'math',
                submissions: 30, accepted: 20, acRate: 0.667, solvers: 8,
            }] as never);

            const res = await request(buildApp()).get('/analytics/problems?search=plus&sortBy=acRate&sortDir=asc');

            expect(res.status).toBe(200);
            expect(mockListProblemsForAnalytics).toHaveBeenCalledWith('plus', 50, 0, 'acRate', 'asc');
            expect(res.body.problems[0].problemId).toBe('aplusb');
        });

        it('rejects an unknown sortBy with 400', async () => {
            const res = await request(buildApp()).get('/analytics/problems?sortBy=bogus');

            expect(res.status).toBe(400);
            expect(mockListProblemsForAnalytics).not.toHaveBeenCalled();
        });
    });

    describe('GET /analytics/users/:userId', () => {
        it('returns 404 when the user is missing', async () => {
            mockGetUserAnalytics.mockResolvedValueOnce(null);

            const res = await request(buildApp()).get('/analytics/users/999');

            expect(res.status).toBe(404);
        });

        it('returns the analytics payload with camelCase keys', async () => {
            mockGetUserAnalytics.mockResolvedValueOnce({
                user: { id: 2, username: 'bob', role: 'user', createdAt: '2026-01-01T00:00:00Z' },
                kpis: { submissions: 20, solved: 4, attempted: 10, acRate: 0.2, totalScore: 400 },
                dailySeries: [], hourHistogram: [], verdictBreakdown: [],
                languageBreakdown: [], cumulativeSolved: [], solvedByCategory: [],
            } as never);

            const res = await request(buildApp()).get('/analytics/users/2');

            expect(res.status).toBe(200);
            expect(res.body.user.username).toBe('bob');
            expect(res.body.kpis.submissions).toBe(20);
        });

        it('rejects a non-numeric userId with 400', async () => {
            const res = await request(buildApp()).get('/analytics/users/abc');

            expect(res.status).toBe(400);
        });
    });

    describe('GET /analytics/problems/:problemId', () => {
        it('returns 404 when the problem is missing', async () => {
            mockGetProblemAnalytics.mockResolvedValueOnce(null);

            const res = await request(buildApp()).get('/analytics/problems/missing');

            expect(res.status).toBe(404);
        });

        it('returns the problem analytics payload', async () => {
            mockGetProblemAnalytics.mockResolvedValueOnce({
                problem: { id: 'aplusb', title: 'A Plus B', createdAt: '2026-01-01T00:00:00Z' },
                kpis: { submissions: 10, accepted: 7, acRate: 0.7, uniqueSubmitters: 5 },
                dailySeries: [], verdictBreakdown: [], testcasePassRates: [],
                runtimeBuckets: [], memoryBuckets: [], firstSolves: [],
            } as never);

            const res = await request(buildApp()).get('/analytics/problems/aplusb');

            expect(res.status).toBe(200);
            expect(res.body.problem.id).toBe('aplusb');
            expect(res.body.kpis.acRate).toBe(0.7);
        });
    });

    describe('GET /analytics/contests/:contestId', () => {
        it('returns 404 when the contest is missing', async () => {
            mockGetContestAnalytics.mockResolvedValueOnce(null);

            const res = await request(buildApp()).get('/analytics/contests/999');

            expect(res.status).toBe(404);
        });

        it('returns the contest analytics payload', async () => {
            mockGetContestAnalytics.mockResolvedValueOnce({
                contest: { contestId: 1, title: 'Test Contest', status: 'finished', startTime: '2026-09-01T08:00:00+00:00', endTime: '2026-09-01T11:00:00+00:00' },
                kpis: { participants: 8, submitters: 5, submissions: 40, accepted: 25, avgScore: 250.5, maxScore: 400 },
                submissionTimeline: [],
                problemStats: [],
                scoreboard: [],
            } as never);

            const res = await request(buildApp()).get('/analytics/contests/1');

            expect(res.status).toBe(200);
            expect(res.body.contest.title).toBe('Test Contest');
            expect(res.body.kpis.avgScore).toBe(250.5);
        });

        it('rejects a non-numeric contestId with 400', async () => {
            const res = await request(buildApp()).get('/analytics/contests/abc');

            expect(res.status).toBe(400);
        });
    });

    describe('role gating', () => {
        it('returns 403 when requireStaffOrAdmin rejects', async () => {
            const res = await request(buildApp(true)).get('/analytics/overview');

            expect(res.status).toBe(403);
            expect(mockGetOverviewAnalytics).not.toHaveBeenCalled();
        });
    });
});
