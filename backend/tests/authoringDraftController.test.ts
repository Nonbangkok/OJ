import express, { Express, NextFunction, Request, Response } from 'express';
import session from 'express-session';
import request from 'supertest';
import authoringDraftRouter from '../controllers/authoringDraftController';
import { errorHandler } from '../middleware/errorHandler';
import * as authoringDraftService from '../services/authoringDraftQueryService';
import * as authorSnapshotService from '../services/authorProfileSnapshotService';
import { ProblemDraftRow } from '../types/authoring';

jest.mock('../services/authoringDraftQueryService');
jest.mock('../services/authorProfileSnapshotService');
jest.mock('../services/authoringTestcaseQueryService', () => ({
  getDraftTestcaseStats: jest.fn().mockResolvedValue({ total: 2, withOutput: 2 }),
}));

const draftRow = (overrides: Partial<ProblemDraftRow> = {}): ProblemDraftRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  problem_id: 'redgate',
  title: 'Red Gate',
  author_profile_id: null,
  author_aka_name: 'Author',
  author_real_name: 'Example Author',
  language: 'Thai',
  country_code: 'THA',
  author_profile_image_png: Buffer.from('profile'),
  category: null,
  time_limit_ms: 1000,
  memory_limit_mb: 256,
  statement_html: '<p>Statement</p>',
  solution_cpp: 'int main() {}',
  generator_cpp: null,
  latest_pdf: Buffer.from('%PDF'),
  latest_pdf_revision: 1,
  template_version: 'red-gate-v1',
  revision: 1,
  verified_revision: null,
  status: 'draft',
  created_by: 7,
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  published_at: null,
  ...overrides,
});

const validCreateBody = {
  problemId: 'redgate',
  title: 'Red Gate',
  authorProfileId: null,
  authorAkaName: 'Author',
  authorRealName: 'Example Author',
  language: 'Thai',
  countryCode: 'THA',
  timeLimitMs: 1000,
  memoryLimitMb: 256,
};

const createTestApp = (role?: 'user' | 'staff' | 'admin'): Express => {
  const app = express();
  app.use(express.json({ limit: '7mb' }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) {
      req.session.userId = 7;
      req.session.role = role;
    }
    next();
  });
  app.use('/', authoringDraftRouter);
  app.use(errorHandler);
  return app;
};

describe('Problem Authoring draft controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows only authenticated admins', async () => {
    const anonymous = await request(createTestApp()).get('/admin/authoring/drafts');
    const staff = await request(createTestApp('staff')).get('/admin/authoring/drafts');

    expect(anonymous.status).toBe(401);
    expect(staff.status).toBe(403);
    expect(authoringDraftService.listProblemDrafts).not.toHaveBeenCalled();
  });

  it('creates a draft for the authenticated admin and omits binary values', async () => {
    const draft = draftRow();
    const manualSnapshot = {
      author_profile_id: null,
      author_aka_name: 'Author',
      author_real_name: 'Example Author',
      language: 'Thai',
      country_code: 'THA',
      author_profile_image_png: Buffer.from('fallback png'),
    };
    (authorSnapshotService.createManualAuthorSnapshot as jest.Mock)
      .mockResolvedValueOnce(manualSnapshot);
    (authoringDraftService.createProblemDraft as jest.Mock).mockResolvedValueOnce(draft);

    const response = await request(createTestApp('admin'))
      .post('/admin/authoring/drafts')
      .send(validCreateBody);

    expect(response.status).toBe(201);
    expect(authoringDraftService.createProblemDraft).toHaveBeenCalledWith(expect.objectContaining({
      problem_id: 'redgate',
      created_by: 7,
      statement_html: '',
      solution_cpp: '',
      generator_cpp: null,
      author_profile_image_png: manualSnapshot.author_profile_image_png,
    }));
    expect(response.body).toEqual(expect.objectContaining({
      id: draft.id,
      problemId: 'redgate',
      solutionCpp: 'int main() {}',
      hasLatestPdf: true,
      hasAuthorProfileImage: true,
    }));
    expect(response.body.latestPdf).toBeUndefined();
    expect(response.body.authorProfileImagePng).toBeUndefined();
  });

  it('creates a draft from authoritative profile snapshot data', async () => {
    const profileId = '33333333-3333-4333-8333-333333333333';
    const snapshot = {
      author_profile_id: profileId,
      author_aka_name: 'Profile AKA',
      author_real_name: 'Profile Name',
      language: 'English',
      country_code: 'USA',
      author_profile_image_png: Buffer.from('profile png'),
    };
    const draft = draftRow({ ...snapshot, author_profile_id: profileId });
    (authorSnapshotService.getAuthorProfileSnapshot as jest.Mock).mockResolvedValueOnce({
      kind: 'resolved',
      snapshot,
    });
    (authoringDraftService.createProblemDraft as jest.Mock).mockResolvedValueOnce(draft);

    const response = await request(createTestApp('admin'))
      .post('/admin/authoring/drafts')
      .send({
        problemId: 'redgate',
        title: 'Red Gate',
        authorProfileId: profileId,
        authorAkaName: 'Caller must not win',
        authorRealName: 'Caller must not win',
        language: 'Thai',
        countryCode: 'THA',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
      });

    expect(response.status).toBe(201);
    expect(authorSnapshotService.getAuthorProfileSnapshot).toHaveBeenCalledWith(profileId);
    expect(authoringDraftService.createProblemDraft).toHaveBeenCalledWith(
      expect.objectContaining(snapshot),
    );
    expect(response.body.authorAkaName).toBe('Profile AKA');
  });

  it('lists camel-case draft summaries', async () => {
    (authoringDraftService.listProblemDrafts as jest.Mock).mockResolvedValueOnce([draftRow()]);

    const response = await request(createTestApp('admin')).get('/admin/authoring/drafts');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({
      problemId: 'redgate',
      authorAkaName: 'Author',
      verifiedRevision: null,
      createdBy: 7,
    })]);
    expect(response.body[0].solutionCpp).toBeUndefined();
  });

  it('returns draft detail and handles a missing id', async () => {
    (authoringDraftService.getProblemDraft as jest.Mock)
      .mockResolvedValueOnce(draftRow())
      .mockResolvedValueOnce(null);

    const found = await request(createTestApp('admin'))
      .get('/admin/authoring/drafts/11111111-1111-4111-8111-111111111111');
    const missing = await request(createTestApp('admin'))
      .get('/admin/authoring/drafts/22222222-2222-4222-8222-222222222222');

    expect(found.status).toBe(200);
    expect(found.body.statementHtml).toBe('<p>Statement</p>');
    // The detail payload carries the real testcase pairing facts so the
    // publish checklist never depends on the draft status lifecycle.
    expect(found.body.testcaseStats).toEqual({ total: 2, withOutput: 2 });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: 'Problem draft not found' });
  });

  it('updates a draft using expectedRevision', async () => {
    const updated = draftRow({ revision: 2, title: 'New title' });
    (authoringDraftService.updateProblemDraft as jest.Mock).mockResolvedValueOnce({
      kind: 'updated',
      draft: updated,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/authoring/drafts/${updated.id}`)
      .send({ expectedRevision: 1, title: 'New title' });

    expect(response.status).toBe(200);
    expect(authoringDraftService.updateProblemDraft).toHaveBeenCalledWith(
      updated.id,
      1,
      { title: 'New title' },
    );
    expect(response.body).toEqual(expect.objectContaining({ title: 'New title', revision: 2 }));
  });

  it('returns the current draft for a revision conflict', async () => {
    const current = draftRow({ revision: 3, title: 'Changed elsewhere' });
    (authoringDraftService.updateProblemDraft as jest.Mock).mockResolvedValueOnce({
      kind: 'revision_conflict',
      draft: current,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/authoring/drafts/${current.id}`)
      .send({ expectedRevision: 2, title: 'My change' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'revision_conflict',
      currentRevision: 3,
      draft: expect.objectContaining({ title: 'Changed elsewhere' }),
    }));
  });

  it('returns a conflict when the draft is already published', async () => {
    const published = draftRow({ status: 'published' });
    (authoringDraftService.updateProblemDraft as jest.Mock).mockResolvedValueOnce({
      kind: 'published',
      draft: published,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/authoring/drafts/${published.id}`)
      .send({ expectedRevision: 1, title: 'My change' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('draft_published');
  });

  it('selects a profile by copying its snapshot in the same optimistic update', async () => {
    const profileId = '33333333-3333-4333-8333-333333333333';
    const snapshot = {
      author_profile_id: profileId,
      author_aka_name: 'Profile AKA',
      author_real_name: 'Profile Name',
      language: 'English',
      country_code: 'USA',
      author_profile_image_png: Buffer.from('profile png'),
    };
    const updated = draftRow({ ...snapshot, revision: 2 });
    (authorSnapshotService.getAuthorProfileSnapshot as jest.Mock).mockResolvedValueOnce({
      kind: 'resolved',
      snapshot,
    });
    (authoringDraftService.updateProblemDraft as jest.Mock).mockResolvedValueOnce({
      kind: 'updated',
      draft: updated,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/authoring/drafts/${updated.id}`)
      .send({
        expectedRevision: 1,
        authorProfileId: profileId,
        authorAkaName: 'Caller must not win',
      });

    expect(response.status).toBe(200);
    expect(authoringDraftService.updateProblemDraft).toHaveBeenCalledWith(
      updated.id,
      1,
      snapshot,
    );
  });

  it('keeps the Problem ID locked in PATCH after a published draft starts a new revision', async () => {
    const publishedAt = new Date('2026-09-13T01:00:00.000Z').toISOString();
    const reopened = draftRow({
      status: 'draft',
      revision: 4,
      published_at: new Date('2026-09-13T01:00:00.000Z'),
    });
    (authoringDraftService.updateProblemDraft as jest.Mock).mockResolvedValueOnce({
      kind: 'published_problem_id_locked',
      draft: reopened,
    });

    const response = await request(createTestApp('admin'))
      .patch(`/admin/authoring/drafts/${reopened.id}`)
      .send({ expectedRevision: 4, problemId: 'new-problem-id' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'published_problem_id_locked',
      draft: expect.objectContaining({ problemId: 'redgate', publishedAt: publishedAt }),
    }));
  });

  it('starts a new revision on a published draft', async () => {
    const publishedAt = new Date('2026-09-13T01:00:00.000Z').toISOString();
    const reopened = draftRow({
      status: 'draft',
      revision: 4,
      verified_revision: null,
      published_at: new Date('2026-09-13T01:00:00.000Z'),
    });
    (authoringDraftService.startProblemDraftRevision as jest.Mock)
      .mockResolvedValueOnce({ kind: 'updated', draft: reopened });

    const response = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${reopened.id}/new-revision`);

    expect(response.status).toBe(200);
    expect(authoringDraftService.startProblemDraftRevision).toHaveBeenCalledWith(reopened.id);
    expect(response.body).toEqual(expect.objectContaining({
      status: 'draft',
      revision: 4,
      verifiedRevision: null,
      publishedAt: publishedAt,
    }));
  });

  it('rejects a new revision for a draft that is not published', async () => {
    const current = draftRow({ status: 'draft' });
    (authoringDraftService.startProblemDraftRevision as jest.Mock)
      .mockResolvedValueOnce({ kind: 'not_published', draft: current });

    const response = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${current.id}/new-revision`);

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'draft_not_published',
      message: 'Only published drafts can start a new revision',
    }));
  });

  it('returns 404 when starting a revision for a missing draft', async () => {
    (authoringDraftService.startProblemDraftRevision as jest.Mock)
      .mockResolvedValueOnce({ kind: 'not_found' });

    const response = await request(createTestApp('admin'))
      .post('/admin/authoring/drafts/22222222-2222-4222-8222-222222222222/new-revision');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Problem draft not found' });
  });

  it('refreshes the linked author profile using expectedRevision', async () => {
    const refreshed = draftRow({ revision: 2, author_aka_name: 'Refreshed AKA' });
    (authorSnapshotService.refreshProblemDraftAuthor as jest.Mock).mockResolvedValueOnce({
      kind: 'updated',
      draft: refreshed,
    });

    const response = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${refreshed.id}/refresh-author-profile`)
      .send({ expectedRevision: 1 });

    expect(response.status).toBe(200);
    expect(authorSnapshotService.refreshProblemDraftAuthor)
      .toHaveBeenCalledWith(refreshed.id, 1);
    expect(response.body).toEqual(expect.objectContaining({
      authorAkaName: 'Refreshed AKA',
      revision: 2,
    }));
  });

  it('validates UUID parameters and patch bodies before calling the service', async () => {
    const invalidId = await request(createTestApp('admin'))
      .get('/admin/authoring/drafts/not-a-uuid');
    const emptyPatch = await request(createTestApp('admin'))
      .patch('/admin/authoring/drafts/11111111-1111-4111-8111-111111111111')
      .send({ expectedRevision: 1 });

    expect(invalidId.status).toBe(400);
    expect(emptyPatch.status).toBe(400);
    expect(authoringDraftService.getProblemDraft).not.toHaveBeenCalled();
    expect(authoringDraftService.updateProblemDraft).not.toHaveBeenCalled();
  });
});
