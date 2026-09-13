import { randomUUID } from 'crypto';
import type { QueryResultRow } from 'pg';
import * as db from '../db';
import { AuthorProfileRow } from '../types/authoring';

export type AuthorProfileDatabase = {
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

type DatabaseConstraintError = {
  code?: string;
  constraint?: string;
};

const isDuplicateUserLink = (error: unknown): boolean => {
  const databaseError = error as DatabaseConstraintError;
  return databaseError?.code === '23505'
    && databaseError.constraint === 'author_profiles_user_id_key';
};

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
