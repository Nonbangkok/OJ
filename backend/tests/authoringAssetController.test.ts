import express, { Express, NextFunction, Request, Response } from 'express';
import session from 'express-session';
import request from 'supertest';
import { STATEMENT_ASSET } from '../constants';
import authoringDraftRouter from '../controllers/authoringDraftController';
import { errorHandler } from '../middleware/errorHandler';
import * as assetService from '../services/authoringAssetQueryService';
import * as statementAssetService from '../services/statementAssetService';
import { ProblemDraftRow } from '../types/authoring';

jest.mock('../services/authoringAssetQueryService');
jest.mock('../services/statementAssetService');

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
  time_limit_ms: 1000,
  memory_limit_mb: 256,
  statement_html: '<p>Statement</p>',
  solution_cpp: 'int main() {}',
  generator_cpp: null,
  latest_pdf: null,
  latest_pdf_revision: null,
  template_version: 'red-gate-v1',
  revision: 2,
  verified_revision: null,
  status: 'draft',
  created_by: 7,
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  published_at: null,
  ...overrides,
});

const metadata = {
  id: '22222222-2222-4222-8222-222222222222',
  draft_id: '11111111-1111-4111-8111-111111111111',
  filename: 'diagram.png',
  mime_type: 'image/png',
  checksum_sha256: 'a'.repeat(64),
  size_bytes: '16',
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
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

describe('Problem Authoring statement asset controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows only authenticated admins', async () => {
    const path = `/admin/authoring/drafts/${metadata.draft_id}/assets`;
    expect((await request(createTestApp()).get(path)).status).toBe(401);
    expect((await request(createTestApp('staff')).get(path)).status).toBe(403);
    expect(assetService.listStatementAssets).not.toHaveBeenCalled();
  });

  it('lists metadata without returning binary content', async () => {
    (assetService.listStatementAssets as jest.Mock).mockResolvedValueOnce({
      kind: 'found',
      assets: [metadata],
    });

    const response = await request(createTestApp('admin'))
      .get(`/admin/authoring/drafts/${metadata.draft_id}/assets`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({
      id: metadata.id,
      draftId: metadata.draft_id,
      filename: 'diagram.png',
      mimeType: 'image/png',
      checksumSha256: metadata.checksum_sha256,
      sizeBytes: 16,
    })]);
    expect(response.body[0].content).toBeUndefined();
  });

  it('returns 404 when listing assets for a missing draft', async () => {
    (assetService.listStatementAssets as jest.Mock).mockResolvedValueOnce({ kind: 'not_found' });
    const response = await request(createTestApp('admin'))
      .get(`/admin/authoring/drafts/${metadata.draft_id}/assets`);
    expect(response.status).toBe(404);
  });

  it('prepares and atomically adds an uploaded asset', async () => {
    const prepared = {
      filename: 'diagram.png',
      mimeType: 'image/png' as const,
      content: Buffer.from('normalized'),
      checksumSha256: metadata.checksum_sha256,
      sizeBytes: 10,
    };
    (statementAssetService.prepareStatementAsset as jest.Mock).mockResolvedValueOnce(prepared);
    (assetService.addStatementAsset as jest.Mock).mockResolvedValueOnce({
      kind: 'added', draft: draftRow(), asset: metadata,
    });

    const response = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1')
      .field('filename', 'diagram.png')
      .attach('asset', Buffer.from('source'), { filename: 'original.png', contentType: 'image/png' });

    expect(response.status).toBe(201);
    expect(statementAssetService.prepareStatementAsset)
      .toHaveBeenCalledWith('diagram.png', expect.any(Buffer), 'image/png');
    expect(assetService.addStatementAsset)
      .toHaveBeenCalledWith(metadata.draft_id, 1, prepared);
    expect(response.body).toEqual(expect.objectContaining({
      draftRevision: 2,
      asset: expect.objectContaining({ id: metadata.id, sizeBytes: 16 }),
    }));
  });

  it('requires an asset file and maps filename conflicts', async () => {
    const missing = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1');
    expect(missing.status).toBe(400);

    (statementAssetService.prepareStatementAsset as jest.Mock).mockResolvedValueOnce({
      filename: 'diagram.png', mimeType: 'image/png', content: Buffer.from('x'),
      checksumSha256: metadata.checksum_sha256, sizeBytes: 1,
    });
    (assetService.addStatementAsset as jest.Mock)
      .mockResolvedValueOnce({ kind: 'duplicate_filename' });
    const duplicate = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1')
      .attach('asset', Buffer.from('source'), { filename: 'diagram.png', contentType: 'image/png' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('asset_filename_conflict');
  });

  it('rejects unsupported or invalid image uploads before persistence', async () => {
    const unsupported = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1')
      .attach('asset', Buffer.from('svg'), { filename: 'diagram.svg', contentType: 'image/svg+xml' });
    expect(unsupported.status).toBe(400);

    (statementAssetService.prepareStatementAsset as jest.Mock)
      .mockRejectedValueOnce(new Error('Invalid statement asset image'));
    const invalid = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1')
      .attach('asset', Buffer.from('not an image'), {
        filename: 'diagram.png', contentType: 'image/png',
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe('Invalid statement asset image');
    expect(assetService.addStatementAsset).not.toHaveBeenCalled();
  });

  it('maps revision conflicts and the aggregate size limit', async () => {
    const prepared = {
      filename: 'diagram.png', mimeType: 'image/png' as const, content: Buffer.from('x'),
      checksumSha256: metadata.checksum_sha256, sizeBytes: 1,
    };
    (statementAssetService.prepareStatementAsset as jest.Mock).mockResolvedValue(prepared);
    (assetService.addStatementAsset as jest.Mock)
      .mockResolvedValueOnce({ kind: 'revision_conflict', draft: draftRow({ revision: 5 }) })
      .mockResolvedValueOnce({ kind: 'total_size_exceeded' });

    const send = () => request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1')
      .attach('asset', Buffer.from('source'), { filename: 'diagram.png', contentType: 'image/png' });
    const conflict = await send();
    const tooLarge = await send();
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(expect.objectContaining({
      code: 'revision_conflict', currentRevision: 5,
    }));
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.code).toBe('asset_total_size_exceeded');
  });

  it('deletes an asset using the expected revision', async () => {
    (assetService.deleteStatementAsset as jest.Mock).mockResolvedValueOnce({
      kind: 'deleted', draft: draftRow(), asset: metadata,
    });
    const response = await request(createTestApp('admin'))
      .delete(`/admin/authoring/drafts/${metadata.draft_id}/assets/${metadata.id}`)
      .query({ expectedRevision: '1' });
    expect(response.status).toBe(200);
    expect(assetService.deleteStatementAsset)
      .toHaveBeenCalledWith(metadata.draft_id, metadata.id, 1);
    expect(response.body).toEqual(expect.objectContaining({ draftRevision: 2 }));
  });

  it('returns 404 when the requested asset does not exist in the draft', async () => {
    (assetService.deleteStatementAsset as jest.Mock)
      .mockResolvedValueOnce({ kind: 'asset_not_found' });
    const response = await request(createTestApp('admin'))
      .delete(`/admin/authoring/drafts/${metadata.draft_id}/assets/${metadata.id}`)
      .query({ expectedRevision: '1' });
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Statement asset not found');
  });

  it('rejects raw asset uploads larger than 10 MiB', async () => {
    const response = await request(createTestApp('admin'))
      .post(`/admin/authoring/drafts/${metadata.draft_id}/assets`)
      .field('expectedRevision', '1')
      .attach('asset', Buffer.alloc(STATEMENT_ASSET.MAX_FILE_BYTES + 1), {
        filename: 'large.png', contentType: 'image/png',
      });
    expect(response.status).toBe(413);
    expect(statementAssetService.prepareStatementAsset).not.toHaveBeenCalled();
  });
});
