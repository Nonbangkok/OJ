import { randomUUID } from 'crypto';
import * as db from '../../db';
import {
  createProblemDraft,
  getProblemDraft,
  listProblemDrafts,
  startProblemDraftRevision,
  updateProblemDraft,
} from '../../services/authoringDraftQueryService';
import { ProblemDraftRow } from '../../types/authoring';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
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
  author_profile_image_png: null,
  categories: [],
  difficulty: null,
  time_limit_ms: 1000,
  memory_limit_mb: 256,
  statement_html: '<p>Old statement</p>',
  solution_cpp: 'int main() {}',
  generator_cpp: null,
  latest_pdf: null,
  latest_pdf_revision: null,
  template_version: 'red-gate-v1',
  revision: 3,
  verified_revision: 3,
  status: 'ready',
  created_by: 7,
  created_at: new Date('2026-09-13T00:00:00.000Z'),
  updated_at: new Date('2026-09-13T00:00:00.000Z'),
  published_at: null,
  ...overrides,
});

describe('updateProblemDraft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates only the expected revision and invalidates readiness', async () => {
    const updated = draftRow({
      title: 'New title',
      statement_html: '<p>New statement</p>',
      revision: 4,
      verified_revision: null,
      status: 'draft',
    });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [updated] });

    const result = await updateProblemDraft(updated.id, 3, {
      title: 'New title',
      statement_html: '<p>New statement</p>',
    });

    expect(result).toEqual({ kind: 'updated', draft: updated });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND revision = $2 AND status <> \'published\''),
      [updated.id, 3, 'New title', '<p>New statement</p>'],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("revision = revision + 1, status = 'draft', verified_revision = NULL"),
      expect.any(Array),
    );
  });

  it('returns the current draft when its revision has changed', async () => {
    const current = draftRow({ revision: 4, title: 'Changed elsewhere' });
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] });

    const result = await updateProblemDraft(current.id, 3, { title: 'My change' });

    expect(result).toEqual({ kind: 'revision_conflict', draft: current });
  });

  it('starts a new draft revision when only the published statement changes', async () => {
    const current = draftRow({ status: 'published', published_at: new Date('2026-09-13T01:00:00.000Z') });
    const updated = draftRow({
      status: 'draft',
      statement_html: '<p>Corrected statement</p>',
      revision: 4,
      verified_revision: null,
      published_at: current.published_at,
    });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [updated] });

    const result = await updateProblemDraft(current.id, 3, { statement_html: '<p>Corrected statement</p>' });

    expect(result).toEqual({ kind: 'updated', draft: updated });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("AND (status <> 'published' OR $4::boolean)"),
      [current.id, 3, '<p>Corrected statement</p>', true],
    );
  });

  it('keeps every other published-draft field read-only', async () => {
    const current = draftRow({ status: 'published', published_at: new Date('2026-09-13T01:00:00.000Z') });
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] });

    const result = await updateProblemDraft(current.id, 3, { title: 'My change' });

    expect(result).toEqual({ kind: 'published', draft: current });
  });

  it('locks the legacy Problem ID after a published statement revision starts', async () => {
    const current = draftRow({ status: 'draft', published_at: new Date('2026-09-13T01:00:00.000Z') });
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] });

    const result = await updateProblemDraft(current.id, 3, { problem_id: 'new-problem-id' });

    expect(result).toEqual({ kind: 'published_problem_id_locked', draft: current });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('AND published_at IS NULL'),
      [current.id, 3, 'new-problem-id'],
    );
  });

  it('returns not_found when the draft does not exist', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await updateProblemDraft(
      '22222222-2222-4222-8222-222222222222',
      1,
      { title: 'My change' },
    );

    expect(result).toEqual({ kind: 'not_found' });
  });
});

describe('startProblemDraftRevision', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an editable draft while keeping the publication linkage', async () => {
    const publishedAt = new Date('2026-09-13T01:00:00.000Z');
    const updated = draftRow({
      status: 'draft',
      revision: 4,
      verified_revision: null,
      published_at: publishedAt,
    });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [updated] });

    const result = await startProblemDraftRevision(updated.id);

    expect(result).toEqual({ kind: 'updated', draft: updated });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND status = 'published'"),
      [updated.id],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'draft',"),
      [updated.id],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('revision = revision + 1'),
      [updated.id],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('verified_revision = NULL'),
      [updated.id],
    );
  });

  it('does not clear published_at so the Problem ID stays locked', async () => {
    const updated = draftRow({ status: 'draft', published_at: new Date('2026-09-13T01:00:00.000Z') });
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [updated] });

    await startProblemDraftRevision(updated.id);

    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).not.toContain('published_at =');
  });

  it('refuses to start a revision for a draft that is not published', async () => {
    const current = draftRow({ status: 'draft' });
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] });

    const result = await startProblemDraftRevision(current.id);

    expect(result).toEqual({ kind: 'not_published', draft: current });
  });

  it('returns not_found when the draft does not exist', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await startProblemDraftRevision('22222222-2222-4222-8222-222222222222');

    expect(result).toEqual({ kind: 'not_found' });
  });
});

describe('problem draft reads and creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a draft with an application-generated UUID and safe initial state', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const profileImage = Buffer.from('profile snapshot png');
    const created = draftRow({
      id,
      revision: 1,
      verified_revision: null,
      status: 'draft',
      statement_html: '',
      solution_cpp: '',
      author_profile_image_png: profileImage,
    });
    (randomUUID as jest.Mock).mockReturnValue(id);
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [created] });

    const result = await createProblemDraft({
      problem_id: 'redgate',
      title: 'Red Gate',
      author_profile_id: null,
      author_aka_name: 'Author',
      author_real_name: 'Example Author',
      language: 'Thai',
      country_code: 'THA',
      author_profile_image_png: profileImage,
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 256,
      created_by: 7,
    });

    expect(result).toEqual(created);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO problem_drafts'),
      [
        id,
        'redgate',
        'Red Gate',
        null,
        'Author',
        'Example Author',
        'Thai',
        'THA',
        profileImage,
        [],
        null,
        1000,
        256,
        '',
        '',
        null,
        'red-gate-v1',
        7,
      ],
    );
  });

  it('lists draft summaries without loading private sources or binary artifacts', async () => {
    const summaries = [{
      id: '11111111-1111-4111-8111-111111111111',
      problem_id: 'redgate',
      title: 'Red Gate',
      author_aka_name: 'Author',
      status: 'draft',
      revision: 3,
      verified_revision: null,
      created_by: 7,
      created_at: new Date('2026-09-13T00:00:00.000Z'),
      updated_at: new Date('2026-09-13T00:00:00.000Z'),
    }];
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: summaries });

    const result = await listProblemDrafts();

    expect(result).toEqual(summaries);
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).not.toContain('solution_cpp');
    expect(sql).not.toContain('generator_cpp');
    expect(sql).not.toContain('latest_pdf');
    expect(sql).not.toContain('profile_image_png');
    expect(sql).toContain('ORDER BY updated_at DESC, id ASC');
  });

  it('returns a complete draft by id', async () => {
    const draft = draftRow();
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [draft] });

    await expect(getProblemDraft(draft.id)).resolves.toEqual(draft);
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM problem_drafts WHERE id = $1',
      [draft.id],
    );
  });

  it('returns null when a draft id does not exist', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await expect(getProblemDraft('44444444-4444-4444-8444-444444444444')).resolves.toBeNull();
  });
});
