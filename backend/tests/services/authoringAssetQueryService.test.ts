import {
  addStatementAsset,
  deleteStatementAsset,
  listStatementAssets,
} from '../../services/authoringAssetQueryService';
import { STATEMENT_ASSET } from '../../constants';
import { ProblemDraftAssetRow, ProblemDraftRow } from '../../types/authoring';

const draftRow = (overrides: Partial<ProblemDraftRow> = {}): ProblemDraftRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  problem_id: 'redgate',
  title: 'Red Gate',
  author_profile_id: null,
  author_aka_name: 'Author',
  author_real_name: 'Example Author',
  language: 'Thai',
  country_code: 'THA',
  author_profile_image_png: null,
  category: null,
  time_limit_ms: 1000,
  memory_limit_mb: 256,
  statement_html: '',
  solution_cpp: '',
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

type AssetMetadataRow = Omit<ProblemDraftAssetRow, 'content'>;

const assetRow = (overrides: Partial<AssetMetadataRow> = {}): AssetMetadataRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  draft_id: '11111111-1111-4111-8111-111111111111',
  filename: 'diagram.png',
  mime_type: 'image/png',
  checksum_sha256: 'a'.repeat(64),
  size_bytes: '16',
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  ...overrides,
});

const preparedAsset = {
  filename: 'diagram.png',
  mimeType: 'image/png' as const,
  content: Buffer.from('normalized image'),
  checksumSha256: 'a'.repeat(64),
  sizeBytes: 16,
};

const transactionDatabase = (...responses: Array<{ rows: unknown[] } | Error>) => {
  const query = jest.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      query.mockRejectedValueOnce(response);
    } else {
      query.mockResolvedValueOnce(response);
    }
  }
  const client = { query, release: jest.fn() };
  return {
    database: { pool: { connect: jest.fn().mockResolvedValue(client) } },
    client,
  };
};

describe('statement asset persistence', () => {
  it('atomically increments draft revision and inserts a prepared asset', async () => {
    const updatedDraft = draftRow({ revision: 3 });
    const insertedAsset = assetRow();
    const { database, client } = transactionDatabase(
      { rows: [] },
      { rows: [updatedDraft] },
      { rows: [{ total_size_bytes: '32' }] },
      { rows: [insertedAsset] },
      { rows: [] },
    );

    const result = await addStatementAsset(
      updatedDraft.id,
      2,
      preparedAsset,
      database,
    );

    expect(result).toEqual({ kind: 'added', draft: updatedDraft, asset: insertedAsset });
    expect(client.query.mock.calls[1][0]).toContain(
      "revision = revision + 1, status = 'draft', verified_revision = NULL",
    );
    expect(client.query.mock.calls[3][1]).toEqual([
      expect.any(String),
      updatedDraft.id,
      'diagram.png',
      'image/png',
      preparedAsset.content,
      preparedAsset.checksumSha256,
      16,
    ]);
    expect(client.query.mock.calls.map(([sql]) => sql.trim())).toEqual(expect.arrayContaining([
      'BEGIN',
      'COMMIT',
    ]));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back the revision when the draft total would exceed 100 MiB', async () => {
    const updatedDraft = draftRow({ revision: 3 });
    const { database, client } = transactionDatabase(
      { rows: [] },
      { rows: [updatedDraft] },
      { rows: [{ total_size_bytes: String(STATEMENT_ASSET.MAX_TOTAL_BYTES) }] },
      { rows: [] },
    );

    const result = await addStatementAsset(updatedDraft.id, 2, preparedAsset, database);

    expect(result).toEqual({ kind: 'total_size_exceeded' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO problem_draft_assets')))
      .toBe(false);
  });

  it('rolls back and reports a duplicate filename from the database constraint', async () => {
    const duplicateError = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'problem_draft_assets_draft_id_filename_key',
    });
    const { database, client } = transactionDatabase(
      { rows: [] },
      { rows: [draftRow({ revision: 3 })] },
      { rows: [{ total_size_bytes: '0' }] },
      duplicateError,
      { rows: [] },
    );

    await expect(addStatementAsset(
      '11111111-1111-4111-8111-111111111111',
      2,
      preparedAsset,
      database,
    )).resolves.toEqual({ kind: 'duplicate_filename' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('returns the current draft when add sees a revision conflict', async () => {
    const current = draftRow({ revision: 3 });
    const { database, client } = transactionDatabase(
      { rows: [] },
      { rows: [] },
      { rows: [current] },
      { rows: [] },
    );

    await expect(addStatementAsset(current.id, 2, preparedAsset, database)).resolves.toEqual({
      kind: 'revision_conflict',
      draft: current,
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('atomically increments revision and deletes only an asset in that draft', async () => {
    const updatedDraft = draftRow({ revision: 3 });
    const deletedAsset = assetRow();
    const { database, client } = transactionDatabase(
      { rows: [] },
      { rows: [updatedDraft] },
      { rows: [deletedAsset] },
      { rows: [] },
    );

    const result = await deleteStatementAsset(
      updatedDraft.id,
      deletedAsset.id,
      2,
      database,
    );

    expect(result).toEqual({ kind: 'deleted', draft: updatedDraft, asset: deletedAsset });
    expect(client.query.mock.calls[2][1]).toEqual([deletedAsset.id, updatedDraft.id]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back the revision when the asset does not exist in that draft', async () => {
    const { database, client } = transactionDatabase(
      { rows: [] },
      { rows: [draftRow({ revision: 3 })] },
      { rows: [] },
      { rows: [] },
    );

    await expect(deleteStatementAsset(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      2,
      database,
    )).resolves.toEqual({ kind: 'asset_not_found' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('lists asset metadata without loading content', async () => {
    const metadata = [{
      id: '22222222-2222-4222-8222-222222222222',
      draft_id: '11111111-1111-4111-8111-111111111111',
      filename: 'diagram.png',
      mime_type: 'image/png',
      checksum_sha256: 'a'.repeat(64),
      size_bytes: '16',
      created_at: new Date('2026-09-13T00:00:00.000Z'),
      updated_at: new Date('2026-09-13T00:00:00.000Z'),
    }];
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: metadata }) };

    await expect(listStatementAssets(metadata[0].draft_id, database)).resolves.toEqual({
      kind: 'found',
      assets: metadata,
    });
    const sql = database.query.mock.calls[1][0];
    expect(sql).not.toContain('content');
    expect(sql).toContain('ORDER BY filename ASC, id ASC');
  });

  it('distinguishes a missing draft from an empty asset list', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(listStatementAssets(
      '44444444-4444-4444-8444-444444444444',
      database,
    )).resolves.toEqual({ kind: 'not_found' });
    expect(database.query).toHaveBeenCalledTimes(1);
  });
});
