import * as db from '../db';
import { query } from '../db';

/** A collection row plus the derived problem summary shown in the admin UI. */
export interface CollectionWithStats {
  id: number;
  name: string;
  description: string | null;
  problem_count: number;
  /** Derived from the member problems' existing visibility — never stored. */
  status: 'empty' | 'all_visible' | 'all_hidden' | 'mixed';
  created_at: Date;
  updated_at: Date;
}

export interface CollectionRow {
  id: number;
  name: string;
  description: string | null;
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
    SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
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
    description: row.description,
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
  description: string | null,
): Promise<CreateCollectionResult> => {
  try {
    const result = await query<CollectionRow>(
      'INSERT INTO collections (name, description) VALUES ($1, $2) RETURNING *',
      [name, description],
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
  description: string | null,
): Promise<UpdateCollectionResult> => {
  try {
    const result = await query<CollectionRow>(
      'UPDATE collections SET name = $2, description = $3, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id, name, description],
    );
    if (!result.rows[0]) return { kind: 'not_found' };
    return { kind: 'updated', collection: result.rows[0] };
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'duplicate_name' };
    throw error;
  }
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
 * Returns the number of problems updated so callers can confirm intent.
 */
export const setCollectionVisibility = async (
  collectionId: number,
  isVisible: boolean,
): Promise<number> => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
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

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';
