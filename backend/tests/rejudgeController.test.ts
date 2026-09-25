import request from 'supertest';
import express, { Express } from 'express';
import session from 'express-session';
import adminRouter from '../controllers/adminController';
import { getContestStatusById } from '../services/contestAccess';
import { rejudgeContest, rejudgeProblem } from '../services/rejudgeService';
import { errorHandler } from '../middleware/errorHandler';
import { CONTEST_STATUS } from '../constants';

// Mock the DB and the two services the rejudge routes depend on. The auth
// middleware is deliberately NOT mocked: the real requireAdmin reads the
// session role, which is how the 403 cases below are exercised.
jest.mock('../db');
jest.mock('../services/contestAccess', () => ({
    getContestStatusById: jest.fn(),
}));
jest.mock('../services/rejudgeService', () => ({
    rejudgeProblem: jest.fn(),
    rejudgeContest: jest.fn(),
}));

describe('Rejudge admin routes', () => {
    let app: Express;

    const buildApp = (role: string | null): Express => {
        const server = express();
        server.use(express.json());
        server.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
        }));
        if (role !== null) {
            server.use((req, _res, next) => {
                req.user = { id: 1, username: 'user1', role: role as 'user', hasAvatar: false };
                next();
            });
        }
        server.use('/', adminRouter);
        server.use(errorHandler);
        return server;
    };

    beforeEach(() => {
        app = buildApp('admin');
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('POST /admin/rejudge/problem/:problemId', () => {
        it('returns queued/skipped counts for an admin', async () => {
            (rejudgeProblem as jest.Mock).mockResolvedValueOnce({ queued: 4, skipped: 1 });

            const res = await request(app).post('/admin/rejudge/problem/P1');

            expect(res.status).toBe(200);
            expect(res.body.queued).toBe(4);
            expect(res.body.skipped).toBe(1);
            expect(rejudgeProblem).toHaveBeenCalledWith('P1');
        });

        it.each(['staff', 'user'])('rejects %s with 403', async (role) => {
            const restricted = buildApp(role);

            const res = await request(restricted).post('/admin/rejudge/problem/P1');

            expect(res.status).toBe(403);
            expect(rejudgeProblem).not.toHaveBeenCalled();
        });

        it('rejects unauthenticated requests', async () => {
            const anonymous = buildApp(null);

            const res = await request(anonymous).post('/admin/rejudge/problem/P1');

            expect(res.status).toBe(401);
            expect(rejudgeProblem).not.toHaveBeenCalled();
        });

        it('validates the problemId path param', async () => {
            const res = await request(app).post('/admin/rejudge/problem/%20'); // whitespace-only id

            expect(res.status).toBe(400);
            expect(rejudgeProblem).not.toHaveBeenCalled();
        });
    });

    describe('POST /admin/rejudge/contest/:contestId', () => {
        it('returns queued/skipped counts for an admin on a running contest', async () => {
            (getContestStatusById as jest.Mock).mockResolvedValueOnce(CONTEST_STATUS.RUNNING);
            (rejudgeContest as jest.Mock).mockResolvedValueOnce({ queued: 7, skipped: 2 });

            const res = await request(app).post('/admin/rejudge/contest/9');

            expect(res.status).toBe(200);
            expect(res.body.queued).toBe(7);
            expect(res.body.skipped).toBe(2);
            expect(getContestStatusById).toHaveBeenCalledWith('9');
            expect(rejudgeContest).toHaveBeenCalledWith(9);
        });

        it('returns 409 when the contest is finished', async () => {
            (getContestStatusById as jest.Mock).mockResolvedValueOnce(CONTEST_STATUS.FINISHED);

            const res = await request(app).post('/admin/rejudge/contest/9');

            expect(res.status).toBe(409);
            expect(rejudgeContest).not.toHaveBeenCalled();
        });

        it('returns 404 when the contest does not exist', async () => {
            (getContestStatusById as jest.Mock).mockResolvedValueOnce(null);

            const res = await request(app).post('/admin/rejudge/contest/9');

            expect(res.status).toBe(404);
            expect(rejudgeContest).not.toHaveBeenCalled();
        });

        it.each(['staff', 'user'])('rejects %s with 403', async (role) => {
            const restricted = buildApp(role);

            const res = await request(restricted).post('/admin/rejudge/contest/9');

            expect(res.status).toBe(403);
            expect(getContestStatusById).not.toHaveBeenCalled();
            expect(rejudgeContest).not.toHaveBeenCalled();
        });

        it('validates the contestId path param', async () => {
            const res = await request(app).post('/admin/rejudge/contest/not-a-number');

            expect(res.status).toBe(400);
            expect(rejudgeContest).not.toHaveBeenCalled();
        });
    });
});
