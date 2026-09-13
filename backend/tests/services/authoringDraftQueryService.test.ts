import * as db from '../../db';
import { updateProblemDraft } from '../../services/authoringDraftQueryService';
import { ProblemDraftRow } from '../../types/authoring';

jest.mock('../../db', () => ({
  query: jest.fn(),
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

  it('keeps a published draft read-only', async () => {
    const current = draftRow({ status: 'published', published_at: new Date('2026-09-13T01:00:00.000Z') });
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] });

    const result = await updateProblemDraft(current.id, 3, { title: 'My change' });

    expect(result).toEqual({ kind: 'published', draft: current });
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
