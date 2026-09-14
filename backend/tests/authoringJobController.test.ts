import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { createAuthoringJobRouter } from '../controllers/authoringJobController';
import { errorHandler } from '../middleware/errorHandler';
import * as jobs from '../services/authoringJobQueryService';

jest.mock('../services/authoringJobQueryService');
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

it('authorizes both queueing and reading jobs for admins only', async () => {
  for (const [role, status] of [[undefined, 401], ['staff', 403]] as const) {
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
