import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import contestRouter from '../controllers/contestController';
import * as db from '../db';
import { getSiteAccessMode } from '../services/siteSettingsService';
import { errorHandler } from '../middleware/errorHandler';
import { UserRole } from '../types/models';

/**
 * Contest visibility gating matrix (mirrors the problem visibility pattern).
 *
 * Hidden contests must be indistinguishable from nonexistent ones for
 * normal users and guests on every public read route, while staff/admin
 * keep full access and the admin management surface never filters.
 */

jest.mock('../db');
jest.mock('../services/siteSettingsService', () => ({
    getSiteAccessMode: jest.fn().mockResolvedValue('public'),
    updateSiteAccessMode: jest.fn(),
    resetSiteAccessModeCache: jest.fn(),
}));
jest.mock('../services/problemMigration');
jest.mock('../services/similarityService');

// Role is injected per-test via the x-test-role header so one app covers
// guest / user / staff / admin.
const ROLE_HEADER = 'x-test-role';
const roleFromHeader = (req: Request): UserRole | undefined => {
    const header = req.headers[ROLE_HEADER];
    if (!header || typeof header !== 'string') return undefined;
    return header === 'guest' ? undefined : (header as UserRole);
};

const buildApp = (): Express => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.use((req: Request, _res: Response, next: NextFunction) => {
        const role = roleFromHeader(req);
        if (role) {
            req.user = { id: 1, username: 'user1', role, hasAvatar: false };
        }
        next();
    });
    app.use('/', contestRouter);
    app.use(errorHandler);
    return app;
};

const get = (app: Express, path: string, role?: string) =>
    request(app).get(path).set(ROLE_HEADER, role ?? 'guest');

const post = (app: Express, path: string, role?: string) =>
    request(app).post(path).set(ROLE_HEADER, role ?? 'guest');

describe('Contest visibility gating', () => {
    let app: Express;

    const query = db.query as jest.Mock;

    beforeEach(() => {
        app = buildApp();
        jest.resetAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('PUT /admin/contests/:id/visibility', () => {
        it('toggles visibility atomically for staff', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 1, title: 'C1', is_visible: false }],
            });

            const res = await request(app)
                .put('/admin/contests/1/visibility')
                .set(ROLE_HEADER, 'staff')
                .send({ isVisible: false });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('visibility updated');
            expect(res.body.contest).toEqual({ id: 1, title: 'C1', is_visible: false });
            // Focused atomic update — no other field is read or written.
            const [sql, params] = query.mock.calls[0];
            expect(String(sql)).toBe('UPDATE contests SET is_visible = $1 WHERE id = $2 RETURNING id, title, is_visible');
            expect(params).toEqual([false, '1']);
        });

        it('returns 404 for a missing contest', async () => {
            query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .put('/admin/contests/999/visibility')
                .set(ROLE_HEADER, 'admin')
                .send({ isVisible: true });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Contest not found');
        });

        it('rejects a non-boolean body with 400', async () => {
            const res = await request(app)
                .put('/admin/contests/1/visibility')
                .set(ROLE_HEADER, 'admin')
                .send({ isVisible: 'yes' });

            expect(res.status).toBe(400);
            expect(query).not.toHaveBeenCalled();
        });

        it('rejects a missing body with 400', async () => {
            const res = await request(app)
                .put('/admin/contests/1/visibility')
                .set(ROLE_HEADER, 'admin')
                .send({});

            expect(res.status).toBe(400);
        });

        it('rejects extra body fields with 400 (strict schema)', async () => {
            const res = await request(app)
                .put('/admin/contests/1/visibility')
                .set(ROLE_HEADER, 'admin')
                .send({ isVisible: true, status: 'finished' });

            expect(res.status).toBe(400);
        });

        it('rejects a normal user with 403', async () => {
            const res = await request(app)
                .put('/admin/contests/1/visibility')
                .set(ROLE_HEADER, 'user')
                .send({ isVisible: false });

            expect(res.status).toBe(403);
            expect(query).not.toHaveBeenCalled();
        });

        it('rejects a guest with 401', async () => {
            const res = await request(app)
                .put('/admin/contests/1/visibility')
                .send({ isVisible: false });

            expect(res.status).toBe(401);
            expect(query).not.toHaveBeenCalled();
        });
    });

    describe('GET /contests (public list)', () => {
        it('filters hidden contests out of the user list', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 2, title: 'Visible One', is_visible: true }],
            });

            const res = await get(app, '/contests', 'user');

            expect(res.status).toBe(200);
            const [sql] = query.mock.calls[0];
            expect(String(sql)).toContain('WHERE c.is_visible = true');
            expect(res.body[0].title).toBe('Visible One');
        });

        it('filters hidden contests out of the guest list (no userId branch)', async () => {
            query.mockResolvedValueOnce({ rows: [] });

            const res = await get(app, '/contests');

            expect(res.status).toBe(200);
            const [sql] = query.mock.calls[0];
            expect(String(sql)).toContain('WHERE c.is_visible = true');
        });

        it('includes hidden contests in the admin management list', async () => {
            query.mockResolvedValueOnce({
                rows: [
                    { id: 1, title: 'Visible One', is_visible: true },
                    { id: 2, title: 'Hidden One', is_visible: false },
                ],
            });

            const res = await get(app, '/admin/contests', 'admin');

            expect(res.status).toBe(200);
            const [sql] = query.mock.calls[0];
            expect(String(sql)).not.toContain('WHERE c.is_visible = true');
            expect(res.body.length).toBe(2);
        });
    });

    describe('GET /contests/:id (detail)', () => {
        const hiddenRow = {
            id: 3, title: 'Hidden', description: null,
            start_time: new Date(), end_time: new Date(),
            status: 'running', created_at: new Date(), created_by: 1,
            is_visible: false, participant_count: '2', created_by_username: 'admin',
        };

        it('reads a hidden contest as 404 for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [hiddenRow] }); // visibility pre-check

            const res = await get(app, '/contests/3', 'user');

            expect(res.status).toBe(404);
            expect(query).toHaveBeenCalledTimes(1);
        });

        it('reads a hidden contest as 404 for a guest', async () => {
            query.mockResolvedValueOnce({ rows: [hiddenRow] });

            const res = await get(app, '/contests/3');

            expect(res.status).toBe(404);
        });

        it('serves a hidden contest detail to staff (direct URL inspection)', async () => {
            query
                .mockResolvedValueOnce({ rows: [hiddenRow] }) // pre-check
                .mockResolvedValueOnce({ rows: [hiddenRow] }) // detail
                .mockResolvedValueOnce({ rows: [] })          // participant check
                .mockResolvedValueOnce({ rows: [] });         // problems (staff sees list)

            const res = await get(app, '/contests/3', 'staff');

            expect(res.status).toBe(200);
            expect(res.body.title).toBe('Hidden');
        });

        it('serves a visible contest detail to a normal user', async () => {
            const visibleRow = { ...hiddenRow, is_visible: true };
            query
                .mockResolvedValueOnce({ rows: [visibleRow] }) // pre-check
                .mockResolvedValueOnce({ rows: [visibleRow] }) // detail
                .mockResolvedValueOnce({ rows: [] });          // participant check

            const res = await get(app, '/contests/3', 'user');

            expect(res.status).toBe(200);
            expect(res.body.title).toBe('Hidden');
        });
    });

    describe('POST /contests/:id/join', () => {
        it('reads a hidden contest as 404 for a normal user', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 3, end_time: new Date(Date.now() + 60_000), is_visible: false }],
            });

            const res = await post(app, '/contests/3/join', 'user');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Contest not found');
        });

        it('lets staff join a hidden contest (management access)', async () => {
            query
                .mockResolvedValueOnce({
                    rows: [{ id: 3, end_time: new Date(Date.now() + 60_000), is_visible: false }],
                })
                .mockResolvedValueOnce({ rowCount: 1 });

            const res = await post(app, '/contests/3/join', 'admin');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /contests/:id/scoreboard', () => {
        it('reads a hidden contest scoreboard as 404 for a guest (PUBLIC mode)', async () => {
            query.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] });

            const res = await get(app, '/contests/3/scoreboard');

            expect(res.status).toBe(404);
        });

        it('reads a hidden contest scoreboard as 404 for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] });

            const res = await get(app, '/contests/3/scoreboard', 'user');

            expect(res.status).toBe(404);
        });

        it('serves a hidden contest scoreboard to admin', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ id: 3, status: 'scheduled', is_visible: false }] })
                .mockResolvedValue({ rows: [] });

            const res = await get(app, '/contests/3/scoreboard', 'admin');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /contests/:id/problems (participant surface)', () => {
        it('reads a hidden contest as 404 for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] });

            const res = await get(app, '/contests/3/problems', 'user');

            expect(res.status).toBe(404);
        });

        it('serves hidden contest problems to staff', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] })
                .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // participant
                .mockResolvedValueOnce({ rows: [] });        // problems

            const res = await get(app, '/contests/3/problems', 'staff');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /contests/:id/problems/:problemId (detail)', () => {
        it('reads a hidden contest as 404 for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] });

            const res = await get(app, '/contests/3/problems/P1', 'user');

            expect(res.status).toBe(404);
        });

        it('reads a hidden contest problem PDF as 404 for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] });

            const res = await get(app, '/contests/3/problems/P1/pdf', 'user');

            expect(res.status).toBe(404);
        });
    });

    describe('PRIVATE mode composes with visibility (AND, not either-or)', () => {
        it('still rejects guests with 401 regardless of the visibility flag', async () => {
            (getSiteAccessMode as jest.Mock).mockResolvedValueOnce('private');

            const res = await get(app, '/contests/3/scoreboard');

            expect(res.status).toBe(401);
            expect(query).not.toHaveBeenCalled();
        });

        it('blocks an authed normal user on a hidden contest in PRIVATE mode too', async () => {
            (getSiteAccessMode as jest.Mock).mockResolvedValueOnce('private');
            query.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running', is_visible: false }] });

            const res = await get(app, '/contests/3/scoreboard', 'user');

            expect(res.status).toBe(404);
        });
    });
});
