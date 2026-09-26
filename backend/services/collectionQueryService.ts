import * as db from '../db';
import { query } from '../db';
import type { PoolClient } from 'pg';
import { isUniqueViolation } from '../utils/dbErrors';

/** A collection row plus the derived problem summary shown in the admin UI. */
export interface CollectionWithStats {
  id: number;
  name: string;
  problem_count: number;
  /** Derived from the member problems' existing visibility — never stored. */
  status: 'empty' | 'all_visible' | 'all_hidden' | 'mixed';
  created_at: Date;
  updated_at: Date;
}

export interface CollectionRow {
  id: number;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export type CreateCollectionResult =
  | { kind: 'created'; collection: CollectionRow }
  | { kind: 'duplicate_name' };

export type UpdateCollectionResult =
  | { kind: 'updated'; collection: CollectionRow }
  | { kind: 'not_found' }
  | { kind: 'duplicate_name' };

/**
 * Collections with per-collection problem counts and the derived visibility
 * status (All Visible / All Hidden / Mixed / Empty), computed from the
 * problems' existing is_visible column in one query.
 */
export const listCollections = async (): Promise<CollectionWithStats[]> => {
  const result = await query<CollectionWithStats & { is_visible_count: string; total_count: string }>(`
    SELECT c.id, c.name, c.created_at, c.updated_at,
      COUNT(p.id) AS total_count,
      COUNT(p.id) FILTER (WHERE p.is_visible) AS is_visible_count
    FROM collections c
    LEFT JOIN problems p ON p.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    problem_count: Number(row.total_count),
    status: deriveStatus(Number(row.total_count), Number(row.is_visible_count)),
  }));
};

const deriveStatus = (total: number, visible: number): CollectionWithStats['status'] => {
  if (total === 0) return 'empty';
  if (visible === 0) return 'all_hidden';
  if (visible === total) return 'all_visible';
  return 'mixed';
};

export const createCollection = async (
  name: string,
): Promise<CreateCollectionResult> => {
  try {
    const result = await query<CollectionRow>(
      'INSERT INTO collections (name) VALUES ($1) RETURNING *',
      [name],
    );
    return { kind: 'created', collection: result.rows[0] };
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'duplicate_name' };
    throw error;
  }
};

export const updateCollection = async (
  id: number,
  name: string,
): Promise<UpdateCollectionResult> => {
  try {
    const result = await query<CollectionRow>(
      'UPDATE collections SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id, name],
    );
    if (!result.rows[0]) return { kind: 'not_found' };
    return { kind: 'updated', collection: result.rows[0] };
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'duplicate_name' };
    throw error;
  }
};

/**
 * Resolve a collection by name for problem import (problem ZIP config.json):
 * reuse the existing collection or create it exactly once. Matching is
 * case-sensitive, mirroring how collections are created/renamed elsewhere
 * (the UNIQUE constraint on collections.name is case-sensitive).
 *
 * Race-free by construction: a single INSERT ... ON CONFLICT (name) DO UPDATE
 * statement both finds and creates the row, so two concurrent imports (or two
 * problems in one batch ZIP referencing the same new name) can never produce
 * duplicates — the loser of the race resolves to the winner's row instead of
 * failing on a unique violation.
 *
 * Runs on the caller's client (a withTransaction PoolClient from the batch
 * upload path) so a later problem-persist failure rolls the auto-created
 * collection back too — no orphan collections. DO UPDATE (not DO NOTHING) is
 * required for RETURNING to always yield a row.
 */
export const resolveCollectionIdByName = async (
  client: PoolClient,
  name: string,
): Promise<number> => {
  const result = await client.query<Pick<CollectionRow, 'id'>>(
    `INSERT INTO collections (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  );
  return result.rows[0].id;
};

/**
 * Delete a collection. Problems are never deleted: the FK's ON DELETE SET NULL
 * detaches them first inside the same statement.
 */
export const deleteCollection = async (id: number): Promise<boolean> => {
  const result = await query('DELETE FROM collections WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
};

/**
 * Flip the existing is_visible state of every problem in a collection, in one
 * transaction — the same column (and therefore the same visibility system)
 * the individual and global toggles write to.
 * Returns the number of problems updated, or null when the collection itself
 * does not exist (mirrors updateCollection/deleteCollection so the route can
 * 404 instead of reporting a bogus "0 problems" success — PROBLEM-005).
 */
export const setCollectionVisibility = async (
  collectionId: number,
  isVisible: boolean,
): Promise<number | null> => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existsResult = await client.query(
      'SELECT id FROM collections WHERE id = $1',
      [collectionId],
    );
    if (existsResult.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const result = await client.query(
      'UPDATE problems SET is_visible = $2 WHERE collection_id = $1',
      [collectionId, isVisible],
    );
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
