import { randomUUID } from 'crypto';
import * as db from '../../db';
import {
  createAuthorProfile,
  getAuthorProfile,
  listAuthorProfiles,
  updateAuthorProfile,
} from '../../services/authorProfileQueryService';
import { AuthorProfileRow } from '../../types/authoring';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
}));

const profileRow = (overrides: Partial<AuthorProfileRow> = {}): AuthorProfileRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 7,
  aka_name: 'Nonbangkok',
  real_name: 'Example Author',
  default_language: 'Thai',
  country_code: 'THA',
  profile_image_png: Buffer.from('normalized png'),
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  ...overrides,
});

describe('author profile persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a profile with an application-generated UUID', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const created = profileRow({ id });
    (randomUUID as jest.Mock).mockReturnValue(id);
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [created] });

    const result = await createAuthorProfile({
      user_id: 7,
      aka_name: 'Nonbangkok',
      real_name: 'Example Author',
      default_language: 'Thai',
      country_code: 'THA',
      profile_image_png: created.profile_image_png,
    });

    expect(result).toEqual({ kind: 'created', profile: created });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO author_profiles'),
      [id, 7, 'Nonbangkok', 'Example Author', 'Thai', 'THA', created.profile_image_png],
    );
  });

  it('reports a duplicate linked user when profile creation hits the unique constraint', async () => {
    (randomUUID as jest.Mock).mockReturnValue('22222222-2222-4222-8222-222222222222');
    (db.query as jest.Mock).mockRejectedValueOnce({
      code: '23505',
      constraint: 'author_profiles_user_id_key',
    });

    await expect(createAuthorProfile({
      user_id: 7,
      aka_name: 'Nonbangkok',
      real_name: 'Example Author',
      default_language: 'Thai',
      country_code: 'THA',
      profile_image_png: null,
    })).resolves.toEqual({ kind: 'duplicate_user_link' });
  });

  it('lists profile metadata without loading image bytes', async () => {
    const summaries = [{
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 7,
      aka_name: 'Nonbangkok',
      real_name: 'Example Author',
      default_language: 'Thai',
      country_code: 'THA',
      has_profile_image: true,
      created_at: new Date('2026-09-13T00:00:00.000Z'),
      updated_at: new Date('2026-09-13T00:00:00.000Z'),
    }];
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: summaries });

    await expect(listAuthorProfiles()).resolves.toEqual(summaries);
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('profile_image_png IS NOT NULL AS has_profile_image');
    expect(sql).toContain('ORDER BY aka_name ASC, id ASC');
    expect(sql).not.toContain('SELECT *');
  });

  it('returns a complete profile by id for snapshotting', async () => {
    const profile = profileRow();
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [profile] });

    await expect(getAuthorProfile(profile.id)).resolves.toEqual(profile);
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM author_profiles WHERE id = $1',
      [profile.id],
    );
  });

  it('returns null when a profile does not exist', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await expect(
      getAuthorProfile('33333333-3333-4333-8333-333333333333'),
    ).resolves.toBeNull();
  });

  it('updates only the provided profile fields', async () => {
    const image = Buffer.from('new normalized png');
    const updated = profileRow({ aka_name: 'Redgate', profile_image_png: image });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [updated] });

    const result = await updateAuthorProfile(updated.id, {
      aka_name: 'Redgate',
      profile_image_png: image,
    });

    expect(result).toEqual({ kind: 'updated', profile: updated });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('aka_name = $2, profile_image_png = $3, updated_at = NOW()'),
      [updated.id, 'Redgate', image],
    );
  });

  it('returns not_found when an update target does not exist', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await expect(updateAuthorProfile(
      '44444444-4444-4444-8444-444444444444',
      { country_code: 'USA' },
    )).resolves.toEqual({ kind: 'not_found' });
  });

  it('reports a duplicate linked user when profile update hits the unique constraint', async () => {
    (db.query as jest.Mock).mockRejectedValueOnce({
      code: '23505',
      constraint: 'author_profiles_user_id_key',
    });

    await expect(updateAuthorProfile(
      '11111111-1111-4111-8111-111111111111',
      { user_id: 8 },
    )).resolves.toEqual({ kind: 'duplicate_user_link' });
  });

  it('rejects an update with no editable fields', async () => {
    await expect(updateAuthorProfile(
      '11111111-1111-4111-8111-111111111111',
      {},
    )).rejects.toThrow('At least one editable author profile field is required');
    expect(db.query).not.toHaveBeenCalled();
  });
});
