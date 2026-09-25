import request from 'supertest';
import express, { Express } from 'express';
import session from 'express-session';

import { errorHandler } from '../middleware/errorHandler';

// db is mocked for the whole file: both the middleware-under-test's
// settings service and the service tests below ride the same mock.
jest.mock('../db', () => ({
    query: jest.fn(),
    pool: { connect: jest.fn() },
}));

import { query as mockedQuery } from '../db';
const query = mockedQuery as jest.Mock;

import { requirePublicAccess } from '../middleware/siteAccess';
import {
    getSiteAccessMode,
    updateSiteAccessMode,
    resetSiteAccessModeCache,
    getPasswordChangeEnabled,
    updatePasswordChangeEnabled,
    resetPasswordChangeEnabledCache,
} from '../services/siteSettingsService';

const buildApp = (withSessionUser: boolean): Express => {
    const server = express();
    server.use(express.json());
    server.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
    if (withSessionUser) {
        server.use((req, _res, next) => {
            req.user = { id: 7, username: 'user7', role: 'user', hasAvatar: false };
            next();
        });
    }
    server.get('/content', requirePublicAccess, (_req, res) => res.json({ ok: true }));
    server.get('/open', (_req, res) => res.json({ ok: true }));
    server.use(errorHandler);
    return server;
};

describe('requirePublicAccess middleware', () => {
    beforeEach(() => {
        resetSiteAccessModeCache();
        query.mockReset();
    });

    it('PUBLIC mode lets guests through to content', async () => {
        query.mockResolvedValue({ rows: [{ setting_value: 'public' }] });
        const res = await request(buildApp(false)).get('/content');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it('PRIVATE mode rejects guests with 401 before the handler runs', async () => {
        query.mockResolvedValue({ rows: [{ setting_value: 'private' }] });
        const res = await request(buildApp(false)).get('/content');
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Authentication required');
    });

    it('PRIVATE mode lets authenticated users through', async () => {
        query.mockResolvedValue({ rows: [{ setting_value: 'private' }] });
        const res = await request(buildApp(true)).get('/content');
        expect(res.status).toBe(200);
    });

    it('does not gate routes that never use the middleware (e.g. login)', async () => {
        query.mockResolvedValue({ rows: [{ setting_value: 'private' }] });
        const res = await request(buildApp(false)).get('/open');
        expect(res.status).toBe(200);
    });
});

describe('siteSettingsService', () => {
    beforeEach(() => {
        resetSiteAccessModeCache();
        query.mockReset();
    });

    it('defaults to public when the setting row does not exist yet', async () => {
        query.mockResolvedValue({ rows: [] });
        expect(await getSiteAccessMode()).toBe('public');
    });

    it('reads the stored mode and caches it within the TTL', async () => {
        query.mockResolvedValue({ rows: [{ setting_value: 'private' }] });
        expect(await getSiteAccessMode()).toBe('private');
        expect(await getSiteAccessMode()).toBe('private');
        // Cache absorbs the second read — only one DB round-trip.
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('rereads after the cache is reset (mode changes propagate)', async () => {
        query.mockResolvedValueOnce({ rows: [{ setting_value: 'public' }] });
        expect(await getSiteAccessMode()).toBe('public');

        query.mockResolvedValueOnce({ rows: [{ setting_value: 'private' }] });
        resetSiteAccessModeCache();
        expect(await getSiteAccessMode()).toBe('private');
    });

    it('updateSiteAccessMode upserts and refreshes the cache immediately', async () => {
        query.mockResolvedValue({ rows: [] });

        await updateSiteAccessMode('private');
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT (setting_key) DO UPDATE'),
            ['site_access_mode', 'private'],
        );
        // The next read must see the new mode without touching the DB.
        expect(await getSiteAccessMode()).toBe('private');
        expect(query).toHaveBeenCalledTimes(1);
    });
});

describe('password change setting (siteSettingsService)', () => {
    beforeEach(() => {
        resetPasswordChangeEnabledCache();
        query.mockReset();
    });

    it('defaults to enabled when the setting row does not exist yet', async () => {
        query.mockResolvedValue({ rows: [] });
        expect(await getPasswordChangeEnabled()).toBe(true);
    });

    it('reads the stored value and caches it within the TTL', async () => {
        query.mockResolvedValue({ rows: [{ setting_value: 'false' }] });
        expect(await getPasswordChangeEnabled()).toBe(false);
        expect(await getPasswordChangeEnabled()).toBe(false);
        // Cache absorbs the second read — only one DB round-trip.
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('rereads after the cache is reset (setting changes propagate)', async () => {
        query.mockResolvedValueOnce({ rows: [{ setting_value: 'true' }] });
        expect(await getPasswordChangeEnabled()).toBe(true);

        query.mockResolvedValueOnce({ rows: [{ setting_value: 'false' }] });
        resetPasswordChangeEnabledCache();
        expect(await getPasswordChangeEnabled()).toBe(false);
    });

    it('updatePasswordChangeEnabled upserts and refreshes the cache immediately', async () => {
        query.mockResolvedValue({ rows: [] });

        await updatePasswordChangeEnabled(false);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT (setting_key) DO UPDATE'),
            ['password_change_enabled', 'false'],
        );
        // The next read must see the new value without touching the DB.
        expect(await getPasswordChangeEnabled()).toBe(false);
        expect(query).toHaveBeenCalledTimes(1);
    });
});


describe('public access matrix (route middleware wiring)', () => {
    // These pin the middleware wiring on the routes that must be
    // PUBLIC-readable but PRIVATE-protected — the enforcement contract the
    // E2E matrix in the spec exercises against the live stack.
    const fs = require('fs');
    const path = require('path');

    const read = (rel: string): string =>
        fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

    it('submissions list + global scoreboard ride requirePublicAccess, not requireAuth', () => {
        const source = read('controllers/submissionController.ts');
        expect(source).toMatch(/'\/submissions',\s*\n\s*\/\/ PUBLIC[\s\S]*?requirePublicAccess/);
        expect(source).toMatch(/'\/scoreboard',[\s\S]*?requirePublicAccess/);
        // Source code stays behind authentication.
        expect(source).toMatch(/'\/submissions\/:id',\s*\n?\s*requireAuth/);
    });

    it('contest scoreboard rides requirePublicAccess, not requireAuth', () => {
        const source = read('controllers/contestController.ts');
        expect(source).toMatch(/'\/contests\/:id\/scoreboard', requirePublicAccess/);
        // Joining a contest stays behind authentication.
        expect(source).toMatch(/'\/contests\/:id\/join', requireAuth/);
    });

    it('contest list rides requirePublicAccess, not requireAuth', () => {
        const source = read('controllers/contestController.ts');
        expect(source).toMatch(/'\/contests', requirePublicAccess/);
    });

    it('problem browsing routes ride requirePublicAccess, not requireAuth', () => {
        const source = read('controllers/problemController.ts');
        expect(source).toMatch(/'\/problems-with-stats', requirePublicAccess/);
        expect(source).toMatch(/'\/problems', requirePublicAccess/);
        expect(source).toMatch(/'\/problems\/:id',\s*\n\s*requirePublicAccess/);
        expect(source).toMatch(/'\/problems\/:id\/pdf', requirePublicAccess/);
        // Admin problem management stays behind staff/admin auth.
        expect(source).toMatch(/'\/admin\/problems', requireAuth, requireStaffOrAdmin/);
    });

    it('guest submissions degrade personal views to an empty public feed', () => {
        const source = read('services/submissionQueryService.ts');
        expect(source).toContain('isGuest && (filter');
    });
});
