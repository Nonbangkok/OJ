import { randomUUID } from 'crypto';
import type { Pool, QueryResultRow } from 'pg';
import * as db from '../db';
import { AuthorProfileRow } from '../types/authoring';
import { isUniqueViolation } from '../utils/dbErrors';

export type AuthorProfileDatabase = {
  pool?: Pick<Pool, 'connect'>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type CreateAuthorProfileInput = Pick<
  AuthorProfileRow,
  | 'user_id'
  | 'aka_name'
  | 'real_name'
  | 'default_language'
  | 'country_code'
  | 'profile_image_png'
>;

export type CreateAuthorProfileResult = {
  kind: 'created';
  profile: AuthorProfileRow;
} | { kind: 'duplicate_user_link' };

export type AuthorProfileListRow = Pick<
  AuthorProfileRow,
  | 'id'
  | 'user_id'
  | 'aka_name'
  | 'real_name'
  | 'default_language'
  | 'country_code'
  | 'created_at'
  | 'updated_at'
> & { has_profile_image: boolean };

type EditableAuthorProfileFields = Pick<
  AuthorProfileRow,
  | 'user_id'
  | 'aka_name'
  | 'real_name'
  | 'default_language'
  | 'country_code'
  | 'profile_image_png'
>;

export type AuthorProfileUpdates = Partial<EditableAuthorProfileFields>;

export type UpdateAuthorProfileResult =
  | { kind: 'updated'; profile: AuthorProfileRow }
  | { kind: 'not_found' }
  | { kind: 'duplicate_user_link' };

export type DeleteAuthorProfileResult =
  | { kind: 'deleted'; profile: AuthorProfileRow; detachedDrafts: number }
  | { kind: 'not_found' }
  | { kind: 'active_drafts'; activeDrafts: number };

const isDuplicateUserLink = (error: unknown): boolean =>
  isUniqueViolation(error, 'author_profiles_user_id_key');

const EDITABLE_PROFILE_FIELDS: readonly (keyof EditableAuthorProfileFields)[] = [
  'user_id',
  'aka_name',
  'real_name',
  'default_language',
  'country_code',
  'profile_image_png',
];

/** Creates an author profile containing only canonical image bytes. */
export const createAuthorProfile = async (
  input: CreateAuthorProfileInput,
  database: AuthorProfileDatabase = db,
): Promise<CreateAuthorProfileResult> => {
  const id = randomUUID();

  try {
    const result = await database.query<AuthorProfileRow>(`
      INSERT INTO author_profiles (
        id, user_id, aka_name, real_name, default_language,
        country_code, profile_image_png
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      id,
      input.user_id,
      input.aka_name,
      input.real_name,
      input.default_language,
      input.country_code,
      input.profile_image_png,
    ]);

    return { kind: 'created', profile: result.rows[0] };
  } catch (error) {
    if (isDuplicateUserLink(error)) {
      return { kind: 'duplicate_user_link' };
    }
    throw error;
  }
};

/** Lists profile metadata without reading profile image BYTEA values. */
export const listAuthorProfiles = async (
  database: AuthorProfileDatabase = db,
): Promise<AuthorProfileListRow[]> => {
  try {
    const result = await database.query<AuthorProfileListRow>(`
      SELECT
        id, user_id, aka_name, real_name, default_language, country_code,
        profile_image_png IS NOT NULL AS has_profile_image,
        created_at, updated_at
      FROM author_profiles
      ORDER BY aka_name ASC, id ASC
    `);
    return result.rows;
  } catch (error) {
    throw error;
  }
};

/** Loads a complete profile for draft snapshot creation. */
export const getAuthorProfile = async (
  profileId: string,
  database: AuthorProfileDatabase = db,
): Promise<AuthorProfileRow | null> => {
  try {
    const result = await database.query<AuthorProfileRow>(
      'SELECT * FROM author_profiles WHERE id = $1',
      [profileId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    throw error;
  }
};

/** Updates only explicitly supplied author profile fields. */
export const updateAuthorProfile = async (
  profileId: string,
  updates: AuthorProfileUpdates,
  database: AuthorProfileDatabase = db,
): Promise<UpdateAuthorProfileResult> => {
  const assignments: string[] = [];
  const values: unknown[] = [profileId];

  for (const field of EDITABLE_PROFILE_FIELDS) {
    const value = updates[field];
    if (value === undefined) {
      continue;
    }
    values.push(value);
    assignments.push(`${field} = $${values.length}`);
  }

  if (assignments.length === 0) {
    throw new Error('At least one editable author profile field is required');
  }

  try {
    const result = await database.query<AuthorProfileRow>(`
      UPDATE author_profiles
      SET ${assignments.join(', ')}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, values);

    const profile = result.rows[0];
    return profile ? { kind: 'updated', profile } : { kind: 'not_found' };
  } catch (error) {
    if (isDuplicateUserLink(error)) {
      return { kind: 'duplicate_user_link' };
    }
    throw error;
  }
};

/** Returns the canonical square PNG for a profile, or null when it has no image. */
export const readAuthorProfileImage = async (
  id: string,
  database: AuthorProfileDatabase = db,
): Promise<Buffer | null> => {
  const result = await database.query<{ profile_image_png: Buffer | null }>(
    'SELECT profile_image_png FROM author_profiles WHERE id = $1',
    [id],
  );
  return result.rows[0]?.profile_image_png ?? null;
};

/**
 * Permanently deletes an author profile and its profile-owned sync history.
 *
 * Dependency policy (per the FK model, chosen to never destroy data):
 * - Active dependent drafts (any status other than `published` whose
 *   `author_profile_id` points at this profile) block deletion: those drafts
 *   still need the profile link for refresh/sync cascades. Reassign or delete
 *   those drafts first.
 * - Published drafts remain and are detached: the FK is
 *   `ON DELETE SET NULL`, and the draft row carries a full frozen author
 *   snapshot (aka name, real name, language, country, image) plus the
 *   published problem already carries `problems.author` — so historical
 *   attribution survives deletion intact.
 * - `authoring_profile_syncs` (+ its items via cascade) are profile-owned
 *   run history and are deleted with the profile, per the model.
 */
export const deleteAuthorProfile = async (
  profileId: string,
  database: AuthorProfileDatabase = db,
): Promise<DeleteAuthorProfileResult> => {
  const runDelete = async (client: {
    query: AuthorProfileDatabase['query'];
  }): Promise<DeleteAuthorProfileResult> => {
    const profileResult = await client.query<AuthorProfileRow>(
      'SELECT * FROM author_profiles WHERE id = $1 FOR UPDATE',
      [profileId],
    );
    const profile = profileResult.rows[0];
    if (!profile) {
      return { kind: 'not_found' };
    }
    const active = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM problem_drafts WHERE author_profile_id = $1 AND status <> 'published'",
      [profileId],
    );
    const activeDrafts = active.rows[0]?.count ?? 0;
    if (activeDrafts > 0) {
      return { kind: 'active_drafts', activeDrafts };
    }
    const detached = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM problem_drafts WHERE author_profile_id = $1',
      [profileId],
    );
    const detachedDrafts = detached.rows[0]?.count ?? 0;
    // Sync history is profile-owned (FK ON DELETE CASCADE from the profile).
    await client.query('DELETE FROM authoring_profile_sync_items WHERE sync_id IN (SELECT id FROM authoring_profile_syncs WHERE profile_id = $1)', [profileId]);
    await client.query('DELETE FROM authoring_profile_syncs WHERE profile_id = $1', [profileId]);
    // Published drafts detach via the FK's ON DELETE SET NULL.
    await client.query('UPDATE problem_drafts SET author_profile_id = NULL WHERE author_profile_id = $1', [profileId]);
    const deleted = await client.query<{ id: string }>(
      'DELETE FROM author_profiles WHERE id = $1 RETURNING id', [profileId]);
    if (!deleted.rows.length) {
      return { kind: 'not_found' };
    }
    return { kind: 'deleted', profile, detachedDrafts };
  };

  if (database.pool) {
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runDelete(client);
      if (result.kind !== 'deleted') {
        await client.query('ROLLBACK');
        return result;
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw error;
    } finally {
      client.release();
    }
  }

  // Fallback for plain-query databases (unit tests).
  return runDelete(database);
};
