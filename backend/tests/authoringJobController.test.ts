import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { createAuthoringJobRouter } from '../controllers/authoringJobController';
import { errorHandler } from '../middleware/errorHandler';
import * as jobs from '../services/authoringJobQueryService';
import * as profileSyncService from '../services/authoringProfileSyncService';

jest.mock('../services/authoringJobQueryService');
jest.mock('../services/authoringProfileSyncService');
const id = '11111111-1111-4111-8111-111111111111';
const app = (role?: string, enabled = true) => {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  a.use((req, _res, next) => { if (role) { req.session.role = role; req.session.userId = 1; } next(); });
  a.use(createAuthoringJobRouter(enabled));
  a.use(errorHandler);
  return a;
};

it('authorizes queueing and reading jobs for admins and staff only', async () => {
  for (const [role, status] of [[undefined, 401], ['user', 403]] as const) {
    expect((await request(app(role)).post(`/admin/authoring/drafts/${id}/jobs/compile`).send({ expectedRevision: 1 })).status).toBe(status);
    expect((await request(app(role)).post(`/admin/authoring/drafts/${id}/jobs/generate`).send({ expectedRevision: 1, seed: '1' })).status).toBe(status);
    expect((await request(app(role)).get(`/admin/authoring/jobs/${id}`)).status).toBe(status);
  }
});

it('returns 503 if the authoring runner transport is not configured', async () => {
  const response = await request(app('admin', false)).post(`/admin/authoring/drafts/${id}/jobs/compile`).send({ expectedRevision: 1 });
  expect(response.status).toBe(503);
  expect((await request(app('admin', false)).post(`/admin/authoring/drafts/${id}/jobs/generate`).send({ expectedRevision: 1, seed: '1' })).status).toBe(503);
});

it('protects PDF build and download, validates revisions, and reports unavailable runner', async () => {
  const url = `/admin/authoring/drafts/${id}/jobs/pdf`;
  for (const [role, status] of [[undefined, 401], ['user', 403]] as const) {
    expect((await request(app(role)).post(url).send({ expectedRevision: 1 })).status).toBe(status);
    expect((await request(app(role)).get(`/admin/authoring/drafts/${id}/pdf`)).status).toBe(status);
  }
  expect((await request(app('admin')).post(url).send({ expectedRevision: 0 })).status).toBe(400);
  expect((await request(app('admin', false)).post(url).send({ expectedRevision: 1 })).status).toBe(503);
});

it('protects output generation with admin authorization, revision validation and runner availability', async () => {
  const url = `/admin/authoring/drafts/${id}/jobs/outputs`;
  expect((await request(app()).post(url).send({ expectedRevision: 1 })).status).toBe(401);
  expect((await request(app('user')).post(url).send({ expectedRevision: 1 })).status).toBe(403);
  expect((await request(app('admin')).post(url).send({ expectedRevision: 0 })).status).toBe(400);
  expect((await request(app('admin')).post(url).send({ expectedRevision: 1, seed: '1' })).status).toBe(400);
  expect((await request(app('admin', false)).post(url).send({ expectedRevision: 1 })).status).toBe(503);
});

it('protects Verify All and accepts only an explicit current revision', async () => {
  const url = `/admin/authoring/drafts/${id}/jobs/verify`;
  expect((await request(app()).post(url).send({ expectedRevision: 1 })).status).toBe(401);
  expect((await request(app('user')).post(url).send({ expectedRevision: 1 })).status).toBe(403);
  for (const body of [{}, { expectedRevision: 0 }, { expectedRevision: 1, regenerate: true }]) {
    expect((await request(app('admin')).post(url).send(body)).status).toBe(400);
  }
  expect((await request(app('admin', false)).post(url).send({ expectedRevision: 1 })).status).toBe(503);
});

it('requires a bounded explicit seed for generation and accepts generator-less drafts without queueing', async () => {
  for (const seed of [undefined, 1, '-1', '18446744073709551616', '1; rm']) {
    expect((await request(app('admin')).post(`/admin/authoring/drafts/${id}/jobs/generate`).send({ expectedRevision: 1, seed })).status).toBe(400);
  }
  (jobs.queueGeneratorJob as jest.Mock).mockResolvedValue({ kind: 'source_missing' });
  const response = await request(app('admin')).post(`/admin/authoring/drafts/${id}/jobs/generate`).send({ expectedRevision: 1, seed: '0' });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('source_missing');
});

it('returns accepted job metadata without its private snapshot', async () => {
  (jobs.queueCompileJob as jest.Mock).mockResolvedValue({ kind: 'queued', job: {
    id, draft_id: id, draft_revision: 1, job_type: 'compile_solution', status: 'queued',
    request_snapshot: { source: 'private code' }, log: '', result_summary: null,
  } });
  const response = await request(app('admin')).post(`/admin/authoring/drafts/${id}/jobs/compile`).send({ expectedRevision: 1 });
  expect(response.status).toBe(202);
  expect(response.body).toEqual(expect.objectContaining({ id, draftRevision: 1, status: 'queued' }));
  expect(JSON.stringify(response.body)).not.toContain('private code');
});

it('rejects invalid job parameters before reserving work', async () => {
  for (const body of [{ expectedRevision: 0 }, { expectedRevision: 1, target: 'shell' }, { expectedRevision: 1, command: 'pwd' }]) {
    expect((await request(app('admin')).post(`/admin/authoring/drafts/${id}/jobs/compile`).send(body)).status).toBe(400);
  }
});

it.each([
  ['not_found', 404, 'draft_not_found'], ['source_missing', 400, 'source_missing'],
  ['busy', 409, 'job_active'], ['revision_conflict', 409, 'revision_conflict'],
  ['published', 409, 'draft_published'], ['queue_full', 429, 'queue_full'],
])('maps %s reservation failures', async (kind, status, code) => {
  (jobs.queueCompileJob as jest.Mock).mockResolvedValue({ kind, jobId: id, currentRevision: 2 });
  const response = await request(app('admin')).post(`/admin/authoring/drafts/${id}/jobs/compile`).send({ expectedRevision: 1 });
  expect(response.status).toBe(status);
  expect(response.body.code).toBe(code);
});

it('returns terminal job diagnostics, and reports a missing job', async () => {
  (jobs.getAuthoringJob as jest.Mock).mockResolvedValueOnce({ id, status: 'failed', log: 'compile error', error_code: 'compile_error', request_snapshot: { source: 'private' } }).mockResolvedValueOnce(null);
  const response = await request(app('admin')).get(`/admin/authoring/jobs/${id}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({ status: 'failed', log: 'compile error', errorCode: 'compile_error' }));
  expect(response.body.request_snapshot).toBeUndefined();
  expect((await request(app('admin')).get(`/admin/authoring/jobs/${id}`)).status).toBe(404);
});

it('lists profile sync cascades for admins and staff', async () => {
  for (const [role, status] of [[undefined, 401], ['user', 403]] as const) {
    expect((await request(app(role)).get('/admin/authoring/profile-syncs')).status).toBe(status);
  }
  (profileSyncService.listProfileSyncs as jest.Mock).mockResolvedValueOnce([{
    id, profileId: id, profileAkaName: 'An author', status: 'succeeded',
    resultSummary: { synced: 2, failed: 0, deferred: 1 },
    createdAt: '2026-09-19T00:00:00Z', finishedAt: '2026-09-19T00:01:00Z',
    progress: { total: 3, synced: 2, failed: 1 },
  }]);
  const response = await request(app('admin')).get('/admin/authoring/profile-syncs');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([expect.objectContaining({
    id, profileAkaName: 'An author', status: 'succeeded', progress: { total: 3, synced: 2, failed: 1 },
  })]);
  // Readable even when the runner transport is disabled, like job history.
  expect((await request(app('admin', false)).get('/admin/authoring/profile-syncs')).status).toBe(200);
});

it('returns one profile sync with per-draft items, and reports a missing run', async () => {
  for (const [role, status] of [[undefined, 401], ['user', 403]] as const) {
    expect((await request(app(role)).get(`/admin/authoring/profile-syncs/${id}`)).status).toBe(status);
  }
  expect((await request(app('admin')).get('/admin/authoring/profile-syncs/not-a-uuid')).status).toBe(400);
  (profileSyncService.getProfileSync as jest.Mock).mockResolvedValueOnce({
    id, profileId: id, status: 'running', resultSummary: null,
    createdAt: '2026-09-19T00:00:00Z', startedAt: '2026-09-19T00:00:05Z', finishedAt: null,
    progress: { total: 2, synced: 1, failed: 0 },
    items: [
      { draftId: id, problemId: 'ABC', title: 'A problem', status: 'synced', attempts: 1, errorMessage: null, draftStatus: 'published', published: true },
      { draftId: '22222222-2222-4222-8222-222222222222', problemId: 'DEF', title: 'Busy draft', status: 'deferred', attempts: 5, errorMessage: 'draft busy with another authoring job', draftStatus: 'draft', published: false },
    ],
  }).mockResolvedValueOnce(null);
  const response = await request(app('admin')).get(`/admin/authoring/profile-syncs/${id}`);
  expect(response.status).toBe(200);
  expect(response.body.items).toHaveLength(2);
  expect(response.body.items[1]).toEqual(expect.objectContaining({ status: 'deferred', errorMessage: 'draft busy with another authoring job' }));
  const missing = await request(app('admin')).get(`/admin/authoring/profile-syncs/${id}`);
  expect(missing.status).toBe(404);
  expect(missing.body.code).toBe('profile_sync_not_found');
});
