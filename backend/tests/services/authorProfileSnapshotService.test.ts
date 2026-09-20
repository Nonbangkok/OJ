import {
  createManualAuthorSnapshot,
  getAuthorProfileSnapshot,
  refreshProblemDraftAuthor,
} from '../../services/authorProfileSnapshotService';
import { AuthorProfileRow, ProblemDraftRow } from '../../types/authoring';

const profileRow = (overrides: Partial<AuthorProfileRow> = {}): AuthorProfileRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: null,
  aka_name: 'Nonbangkok',
  real_name: 'Example Author',
  default_language: 'Thai',
  country_code: 'THA',
  profile_image_png: Buffer.from('normalized png'),
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  ...overrides,
});

const draftRow = (overrides: Partial<ProblemDraftRow> = {}): ProblemDraftRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  problem_id: 'redgate',
  title: 'Red Gate',
  author_profile_id: '11111111-1111-4111-8111-111111111111',
  author_aka_name: 'Old AKA',
  author_real_name: 'Old Name',
  language: 'English',
  country_code: 'USA',
  author_profile_image_png: Buffer.from('old png'),
  categories: [],
  time_limit_ms: 1000,
  memory_limit_mb: 256,
  statement_html: '',
  solution_cpp: '',
  generator_cpp: null,
  latest_pdf: null,
  latest_pdf_revision: null,
  template_version: 'red-gate-v1',
  revision: 3,
  verified_revision: null,
  status: 'draft',
  created_by: 7,
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  published_at: null,
  ...overrides,
});

describe('author profile snapshots', () => {
  it('creates a canonical fallback snapshot for a manual author', async () => {
    const snapshot = await createManualAuthorSnapshot({
      author_aka_name: 'Manual Author',
      author_real_name: 'Example Author',
      language: 'Thai',
      country_code: 'THA',
    });

    expect(snapshot).toEqual(expect.objectContaining({
      author_profile_id: null,
      author_aka_name: 'Manual Author',
      author_real_name: 'Example Author',
      language: 'Thai',
      country_code: 'THA',
    }));
    expect(snapshot.author_profile_image_png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it('copies display data and canonical image bytes from a profile', async () => {
    const profile = profileRow();
    const database = {
      query: jest.fn().mockResolvedValueOnce({ rows: [profile] }),
    };

    const result = await getAuthorProfileSnapshot(profile.id, database);

    expect(result).toEqual({
      kind: 'resolved',
      snapshot: {
        author_profile_id: profile.id,
        author_aka_name: 'Nonbangkok',
        author_real_name: 'Example Author',
        language: 'Thai',
        country_code: 'THA',
        author_profile_image_png: profile.profile_image_png,
      },
    });
  });

  it('creates a fallback PNG when the profile has no image', async () => {
    const profile = profileRow({ profile_image_png: null });
    const database = {
      query: jest.fn().mockResolvedValueOnce({ rows: [profile] }),
    };

    const result = await getAuthorProfileSnapshot(profile.id, database);

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.snapshot.author_profile_image_png.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
  });

  it('reports a missing profile without creating a snapshot', async () => {
    const database = {
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    };

    await expect(getAuthorProfileSnapshot(
      '33333333-3333-4333-8333-333333333333',
      database,
    )).resolves.toEqual({ kind: 'profile_not_found' });
  });

  it('refreshes the snapshot through the draft optimistic update', async () => {
    const current = draftRow();
    const profile = profileRow();
    const updated = draftRow({
      author_aka_name: profile.aka_name,
      author_real_name: profile.real_name,
      language: profile.default_language,
      country_code: profile.country_code,
      author_profile_image_png: profile.profile_image_png,
      revision: 4,
    });
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [current] })
        .mockResolvedValueOnce({ rows: [profile] })
        .mockResolvedValueOnce({ rows: [updated] }),
    };

    const result = await refreshProblemDraftAuthor(current.id, 3, database);

    expect(result).toEqual({ kind: 'updated', draft: updated });
    const updateCall = database.query.mock.calls[2];
    expect(updateCall[1]).toEqual([
      current.id,
      3,
      profile.id,
      profile.aka_name,
      profile.real_name,
      profile.default_language,
      profile.country_code,
      profile.profile_image_png,
    ]);
  });

  it('does not load a profile when the draft revision already conflicts', async () => {
    const current = draftRow({ revision: 4 });
    const database = {
      query: jest.fn().mockResolvedValueOnce({ rows: [current] }),
    };

    await expect(refreshProblemDraftAuthor(current.id, 3, database)).resolves.toEqual({
      kind: 'revision_conflict',
      draft: current,
    });
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('requires a linked profile before refreshing', async () => {
    const current = draftRow({ author_profile_id: null });
    const database = {
      query: jest.fn().mockResolvedValueOnce({ rows: [current] }),
    };

    await expect(refreshProblemDraftAuthor(current.id, 3, database)).resolves.toEqual({
      kind: 'profile_not_selected',
      draft: current,
    });
  });
});
