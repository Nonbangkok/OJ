import express, { Express } from 'express';
import request from 'supertest';
import lessonRoutes from '../controllers/lessonController';
import adminLessonRoutes from '../controllers/adminLessonController';
import { errorHandler } from '../middleware/errorHandler';
import * as query from '../services/lessonQueryService';
import * as importer from '../services/lessonImportService';
import { LessonBundleError } from '../services/lessonBundleReader';
import { getSiteAccessMode } from '../services/siteSettingsService';
import { beginMaintenanceMode, endMaintenanceMode } from '../services/maintenanceMode';

jest.mock('../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../services/lessonQueryService');
jest.mock('../services/lessonImportService');
jest.mock('../services/siteSettingsService');

type Role = 'user' | 'staff' | 'admin';
const buildApp = (role?: Role): Express => {
  const app = express();
  app.use(express.json());
  if (role) {
    app.use((req, _res, next) => {
      req.user = { id: 7, username: 'nattapat', role, hasAvatar: false };
      next();
    });
  }
  app.use(lessonRoutes);
  app.use(adminLessonRoutes);
  app.use(errorHandler);
  return app;
};

const plan: importer.LessonImportPlan = {
  bundleSha256: 'a'.repeat(64),
  sourceCommit: 'a1b2c3d',
  lessons: { added: [], changed: [], removed: [], unchanged: 3 },
  tracks: { added: [], removed: [] },
  issues: [],
};

beforeEach(() => {
  (getSiteAccessMode as jest.Mock).mockResolvedValue('public');
});

describe('Learn read routes', () => {
  it('serves tracks to guests in public mode with a guest viewer', async () => {
    (query.getLearnTracks as jest.Mock).mockResolvedValue({ tracks: [], continueLesson: null });
    const res = await request(buildApp()).get('/learn/tracks');
    expect(res.status).toBe(200);
    expect(query.getLearnTracks).toHaveBeenCalledWith({ userId: null, isStaff: false });
  });

  it('401s guests in private mode', async () => {
    (getSiteAccessMode as jest.Mock).mockResolvedValue('private');
    const res = await request(buildApp()).get('/learn/tracks');
    expect(res.status).toBe(401);
    expect(query.getLearnTracks).not.toHaveBeenCalled();
  });

  it('passes staff as a staff viewer', async () => {
    (query.getLearnTrack as jest.Mock).mockResolvedValue({ track: {}, modules: [] });
    await request(buildApp('staff')).get('/learn/tracks/foundations');
    expect(query.getLearnTrack).toHaveBeenCalledWith('foundations', { userId: 7, isStaff: true });
  });

  it('404s a missing or hidden track and lesson', async () => {
    (query.getLearnTrack as jest.Mock).mockResolvedValue(null);
    (query.getLearnLesson as jest.Mock).mockResolvedValue(null);
    expect((await request(buildApp('user')).get('/learn/tracks/graphs')).status).toBe(404);
    expect((await request(buildApp('user')).get('/learn/lessons/prefix-sums')).status).toBe(404);
  });

  it('rejects malformed slugs before touching the database', async () => {
    const res = await request(buildApp('user')).get('/learn/lessons/Prefix_Sums');
    expect(res.status).toBe(400);
    expect(query.getLearnLesson).not.toHaveBeenCalled();
  });

  it('serves an asset as a sandboxed, non-sniffable image', async () => {
    (query.getLessonAsset as jest.Mock).mockResolvedValue({ mimeType: 'image/png', data: Buffer.from('png') });
    const res = await request(buildApp()).get('/learn/lessons/prefix-sums/assets/figure-1.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('rejects asset names with path segments', async () => {
    const res = await request(buildApp()).get('/learn/lessons/prefix-sums/assets/..%2Fsecret');
    expect(res.status).toBe(400);
  });
});

describe('PUT /learn/lessons/:slug/progress', () => {
  it('requires a session', async () => {
    const res = await request(buildApp()).put('/learn/lessons/prefix-sums/progress').send({ completed: true });
    expect(res.status).toBe(401);
  });

  it('marks a visible lesson complete for the session user', async () => {
    (query.findVisibleLessonId as jest.Mock).mockResolvedValue(12);
    (query.setLessonCompleted as jest.Mock).mockResolvedValue('2026-11-20T10:00:00.000Z');
    const res = await request(buildApp('user')).put('/learn/lessons/prefix-sums/progress').send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ completed: true, completedAt: '2026-11-20T10:00:00.000Z' });
    expect(query.setLessonCompleted).toHaveBeenCalledWith(7, 12, true);
  });

  it('404s a lesson the user cannot see and validates the body', async () => {
    (query.findVisibleLessonId as jest.Mock).mockResolvedValue(null);
    expect((await request(buildApp('user')).put('/learn/lessons/hidden/progress').send({ completed: true })).status).toBe(404);
    expect((await request(buildApp('user')).put('/learn/lessons/x/progress').send({ completed: 'yes' })).status).toBe(400);
    expect(query.setLessonCompleted).not.toHaveBeenCalled();
  });
});

describe('POST /admin/lessons/import', () => {
  const zip = Buffer.from('PK fake');

  it('is staff-only', async () => {
    expect((await request(buildApp()).post('/admin/lessons/import')).status).toBe(401);
    expect((await request(buildApp('user')).post('/admin/lessons/import')).status).toBe(403);
  });

  it('previews on dryRun=1 without importing', async () => {
    (importer.previewLessonImport as jest.Mock).mockResolvedValue(plan);
    const res = await request(buildApp('staff')).post('/admin/lessons/import?dryRun=1').attach('bundle', zip, 'lessons-bundle.zip');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dryRun: true, plan });
    expect(importer.importLessonBundle).not.toHaveBeenCalled();
  });

  it('maps import outcomes to 200 / 400 / 409', async () => {
    const app = buildApp('admin');
    (importer.importLessonBundle as jest.Mock).mockResolvedValueOnce({ kind: 'imported', plan, importId: 5 });
    const ok = await request(app).post('/admin/lessons/import').attach('bundle', zip, 'b.zip');
    expect(ok.status).toBe(200);
    expect(ok.body.importId).toBe(5);
    expect(importer.importLessonBundle).toHaveBeenCalledWith(expect.any(Buffer), { userId: 7, confirmRemovals: false });

    (importer.importLessonBundle as jest.Mock).mockResolvedValueOnce({ kind: 'invalid', plan });
    expect((await request(app).post('/admin/lessons/import').attach('bundle', zip, 'b.zip')).status).toBe(400);

    (importer.importLessonBundle as jest.Mock).mockResolvedValueOnce({ kind: 'needs_confirmation', plan });
    expect((await request(app).post('/admin/lessons/import').attach('bundle', zip, 'b.zip')).status).toBe(409);

    (importer.importLessonBundle as jest.Mock).mockResolvedValueOnce({ kind: 'imported', plan, importId: 6 });
    await request(app).post('/admin/lessons/import?confirmRemovals=1').attach('bundle', zip, 'b.zip');
    expect(importer.importLessonBundle).toHaveBeenLastCalledWith(expect.any(Buffer), { userId: 7, confirmRemovals: true });
  });

  it('answers 400 for an unreadable bundle and for a missing or extra file', async () => {
    (importer.previewLessonImport as jest.Mock).mockRejectedValue(new LessonBundleError('The upload is not a readable ZIP file.'));
    const bad = await request(buildApp('staff')).post('/admin/lessons/import?dryRun=1').attach('bundle', zip, 'b.zip');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('The upload is not a readable ZIP file.');

    expect((await request(buildApp('staff')).post('/admin/lessons/import')).status).toBe(400);
    const extra = await request(buildApp('staff')).post('/admin/lessons/import')
      .attach('bundle', zip, 'a.zip').attach('bundle', zip, 'b.zip');
    expect(extra.status).toBe(400);
    const field = await request(buildApp('staff')).post('/admin/lessons/import').field('note', 'x').attach('bundle', zip, 'a.zip');
    expect(field.status).toBe(400);
  });

  it('rejects unknown query flags', async () => {
    const res = await request(buildApp('staff')).post('/admin/lessons/import?force=1').attach('bundle', zip, 'b.zip');
    expect(res.status).toBe(400);
  });

  it('refuses while a database import holds maintenance mode', async () => {
    beginMaintenanceMode();
    try {
      const res = await request(buildApp('staff')).post('/admin/lessons/import').attach('bundle', zip, 'b.zip');
      expect(res.status).toBe(409);
    } finally {
      endMaintenanceMode();
    }
  });
});

describe('PATCH /admin/lessons/tracks/:id', () => {
  it('toggles visibility and 404s an unknown track', async () => {
    (importer.setLessonTrackVisibility as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const ok = await request(buildApp('staff')).patch('/admin/lessons/tracks/3').send({ isVisible: false });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: 3, isVisible: false });
    expect((await request(buildApp('staff')).patch('/admin/lessons/tracks/99').send({ isVisible: true })).status).toBe(404);
    expect((await request(buildApp('user')).patch('/admin/lessons/tracks/3').send({ isVisible: true })).status).toBe(403);
  });
});
