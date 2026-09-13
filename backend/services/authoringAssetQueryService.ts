import { randomUUID } from 'crypto';
import type { QueryResultRow } from 'pg';
import * as db from '../db';
import { STATEMENT_ASSET } from '../constants';
import { ProblemDraftAssetRow, ProblemDraftRow } from '../types/authoring';
import { PreparedStatementAsset } from './statementAssetService';

export type StatementAssetMetadataRow = Omit<ProblemDraftAssetRow, 'content'>;

type AssetQueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
};

export type AuthoringAssetDatabase = {
  pool: {
    connect(): Promise<AssetQueryClient>;
  };
};

type AuthoringAssetListDatabase = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

type DraftMutationFailure =
  | { kind: 'revision_conflict'; draft: ProblemDraftRow }
  | { kind: 'published'; draft: ProblemDraftRow }
  | { kind: 'not_found' };

export type AddStatementAssetResult =
  | { kind: 'added'; draft: ProblemDraftRow; asset: StatementAssetMetadataRow }
  | { kind: 'duplicate_filename' }
  | { kind: 'total_size_exceeded' }
  | DraftMutationFailure;

export type DeleteStatementAssetResult =
  | { kind: 'deleted'; draft: ProblemDraftRow; asset: StatementAssetMetadataRow }
  | { kind: 'asset_not_found' }
  | DraftMutationFailure;

type DraftAdvanceResult =
  | { kind: 'advanced'; draft: ProblemDraftRow }
  | DraftMutationFailure;

type DatabaseConstraintError = {
  code?: string;
  constraint?: string;
};

const isDuplicateAssetFilename = (error: unknown): boolean => {
  const databaseError = error as DatabaseConstraintError;
  return databaseError?.code === '23505'
    && databaseError.constraint === 'problem_draft_assets_draft_id_filename_key';
};

const advanceDraftRevision = async (
  client: AssetQueryClient,
  draftId: string,
  expectedRevision: number,
): Promise<DraftAdvanceResult> => {
  const updateResult = await client.query<ProblemDraftRow>(`
    UPDATE problem_drafts
    SET revision = revision + 1, status = 'draft', verified_revision = NULL,
        updated_at = NOW()
    WHERE id = $1 AND revision = $2 AND status <> 'published'
    RETURNING *
  `, [draftId, expectedRevision]);
  const updatedDraft = updateResult.rows[0];
  if (updatedDraft) {
    return { kind: 'advanced', draft: updatedDraft };
  }

  const currentResult = await client.query<ProblemDraftRow>(
    'SELECT * FROM problem_drafts WHERE id = $1',
    [draftId],
  );
  const currentDraft = currentResult.rows[0];
  if (!currentDraft) {
    return { kind: 'not_found' };
  }
  if (currentDraft.status === 'published') {
    return { kind: 'published', draft: currentDraft };
  }
  return { kind: 'revision_conflict', draft: currentDraft };
};

const rollback = async (client: AssetQueryClient): Promise<void> => {
  await client.query('ROLLBACK');
};

/** Adds one normalized statement asset and advances its draft atomically. */
export const addStatementAsset = async (
  draftId: string,
  expectedRevision: number,
  asset: PreparedStatementAsset,
  database: AuthoringAssetDatabase = db,
): Promise<AddStatementAssetResult> => {
  const client = await database.pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const draftResult = await advanceDraftRevision(client, draftId, expectedRevision);
    if (draftResult.kind !== 'advanced') {
      await rollback(client);
      transactionOpen = false;
      return draftResult;
    }

    const sizeResult = await client.query<{ total_size_bytes: string }>(`
      SELECT COALESCE(SUM(size_bytes), 0)::text AS total_size_bytes
      FROM problem_draft_assets
      WHERE draft_id = $1
    `, [draftId]);
    const currentSize = BigInt(sizeResult.rows[0]?.total_size_bytes ?? '0');
    if (currentSize + BigInt(asset.sizeBytes) > BigInt(STATEMENT_ASSET.MAX_TOTAL_BYTES)) {
      await rollback(client);
      transactionOpen = false;
      return { kind: 'total_size_exceeded' };
    }

    const insertResult = await client.query<StatementAssetMetadataRow>(`
      INSERT INTO problem_draft_assets (
        id, draft_id, filename, mime_type, content, checksum_sha256, size_bytes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, draft_id, filename, mime_type, checksum_sha256,
                size_bytes, created_at, updated_at
    `, [
      randomUUID(),
      draftId,
      asset.filename,
      asset.mimeType,
      asset.content,
      asset.checksumSha256,
      asset.sizeBytes,
    ]);

    await client.query('COMMIT');
    transactionOpen = false;
    return { kind: 'added', draft: draftResult.draft, asset: insertResult.rows[0] };
  } catch (error) {
    if (transactionOpen) {
      await rollback(client);
    }
    if (isDuplicateAssetFilename(error)) {
      return { kind: 'duplicate_filename' };
    }
    throw error;
  } finally {
    client.release();
  }
};

/** Deletes one statement asset and advances its draft atomically. */
export const deleteStatementAsset = async (
  draftId: string,
  assetId: string,
  expectedRevision: number,
  database: AuthoringAssetDatabase = db,
): Promise<DeleteStatementAssetResult> => {
  const client = await database.pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const draftResult = await advanceDraftRevision(client, draftId, expectedRevision);
    if (draftResult.kind !== 'advanced') {
      await rollback(client);
      transactionOpen = false;
      return draftResult;
    }

    const deleteResult = await client.query<StatementAssetMetadataRow>(`
      DELETE FROM problem_draft_assets
      WHERE id = $1 AND draft_id = $2
      RETURNING id, draft_id, filename, mime_type, checksum_sha256,
                size_bytes, created_at, updated_at
    `, [assetId, draftId]);
    const deletedAsset = deleteResult.rows[0];
    if (!deletedAsset) {
      await rollback(client);
      transactionOpen = false;
      return { kind: 'asset_not_found' };
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return { kind: 'deleted', draft: draftResult.draft, asset: deletedAsset };
  } catch (error) {
    if (transactionOpen) {
      await rollback(client);
    }
    throw error;
  } finally {
    client.release();
  }
};

/** Lists statement asset metadata without loading binary content. */
export const listStatementAssets = async (
  draftId: string,
  database: AuthoringAssetListDatabase = db,
): Promise<StatementAssetMetadataRow[]> => {
  try {
    const result = await database.query<StatementAssetMetadataRow>(`
      SELECT id, draft_id, filename, mime_type, checksum_sha256,
             size_bytes, created_at, updated_at
      FROM problem_draft_assets
      WHERE draft_id = $1
      ORDER BY filename ASC, id ASC
    `, [draftId]);
    return result.rows;
  } catch (error) {
    throw error;
  }
};
