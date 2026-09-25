import * as db from '../../db';
import {
  createProblem,
  getProblemsWithStatsForUser,
  getPublicProblemCategoryCounts,
  updateProblem,
  updateProblemPdf,
} from '../../services/problemQueryService';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const query = db.query as jest.Mock;

describe('problemQueryService difficulty handling', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('selects difficulty in the user-facing problem list', async () => {
    await getProblemsWithStatsForUser(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('p.difficulty');
  });

  describe('paginated problem list (Show More)', () => {
    const row = (id: string, difficulty: number | null = null) => ({
      id, title: id, author: null, categories: [], difficulty,
      best_score: null, submission_count: null, latest_submission_at: null,
      latest_submission_status: null, best_submission_status: null, best_submission_results: null,
    });

    it('applies LIMIT in SQL (limit + 1 rows fetched, batch selected first)', async () => {
      await getProblemsWithStatsForUser(1, { limit: 20 });
      const sql = query.mock.calls[0][0] as string;
      // The batch CTE pages in SQL — filters, ORDER BY and LIMIT all inside.
      expect(sql).toMatch(/WITH batch AS \(\s*SELECT p\.id/);
      expect(sql).toMatch(/ORDER BY p\.id\s*LIMIT \$\d+/);
      // limit + 1 is the parameterized fetch bound.
      expect(query.mock.calls[0][1]).toContain(21);
      // Stats CTEs are restricted to the batch's problem ids.
      expect(sql).toContain('s.problem_id IN (SELECT id FROM batch)');
    });

    it('returns hasMore/nextCursor from the extra row and drops it', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => row(`p${i}`));
      query.mockResolvedValueOnce({ rows });

      const page = await getProblemsWithStatsForUser(1, { limit: 2 });

      expect(page.problems.map(p => p.id)).toEqual(['p0', 'p1']);
      expect(page.hasMore).toBe(true);
      expect(typeof page.nextCursor).toBe('string');
      // The cursor is opaque: base64url JSON of the last row's sort key.
      const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
      expect(decoded).toEqual({ s: '', o: 'asc', id: 'p1', d: null });
    });

    it('returns hasMore false and no cursor on the last page', async () => {
      query.mockResolvedValueOnce({ rows: [row('a'), row('b')] });

      const page = await getProblemsWithStatsForUser(1, { limit: 5 });

      expect(page.problems).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('builds keyset predicates per sort mode and follows the cursor id direction', async () => {
      // Default order: id strictly greater.
      await getProblemsWithStatsForUser(1, { limit: 20, cursor: Buffer.from(JSON.stringify({ s: '', o: 'asc', id: 'x', d: null })).toString('base64url') });
      expect(query.mock.calls[0][0]).toContain('p.id > $');
      query.mockClear();

      // Difficulty asc after a rated cursor: greater difficulty, ties by id,
      // plus every Unrated row (NULLS LAST).
      await getProblemsWithStatsForUser(1, {
        limit: 20, sort: 'difficulty', order: 'asc',
        cursor: Buffer.from(JSON.stringify({ s: 'difficulty', o: 'asc', id: 'x', d: 1500 })).toString('base64url'),
      });
      const ascSql = query.mock.calls[0][0] as string;
      expect(ascSql).toContain('p.difficulty > $');
      expect(ascSql).toContain('p.id > $');
      expect(ascSql).toContain('p.difficulty IS NULL');
      query.mockClear();

      // Difficulty desc after a rated cursor: lesser difficulty, ties by id.
      await getProblemsWithStatsForUser(1, {
        limit: 20, sort: 'difficulty', order: 'desc',
        cursor: Buffer.from(JSON.stringify({ s: 'difficulty', o: 'desc', id: 'x', d: 1500 })).toString('base64url'),
      });
      const descSql = query.mock.calls[0][0] as string;
      expect(descSql).toContain('p.difficulty < $');
      expect(descSql).toContain('p.id < $');
      query.mockClear();

      // Difficulty desc after an Unrated cursor: only Unrated rows remain.
      await getProblemsWithStatsForUser(1, {
        limit: 20, sort: 'difficulty', order: 'desc',
        cursor: Buffer.from(JSON.stringify({ s: 'difficulty', o: 'desc', id: 'x', d: null })).toString('base64url'),
      });
      expect(query.mock.calls[0][0]).toContain('p.difficulty IS NULL AND p.id < $');
    });

    it('rejects a cursor issued for a different sort mode', async () => {
      const cursor = Buffer.from(JSON.stringify({ s: '', o: 'asc', id: 'x', d: null })).toString('base64url');
      await expect(getProblemsWithStatsForUser(1, { sort: 'difficulty', order: 'asc', cursor }))
        .rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects an undecodable cursor', async () => {
      await expect(getProblemsWithStatsForUser(1, { cursor: 'not-a-cursor' }))
        .rejects.toMatchObject({ statusCode: 400 });
    });

    it('composes search, category and difficulty filters before pagination', async () => {
      await getProblemsWithStatsForUser(1, {
        limit: 20, search: '100% _x', category: 'Graph', difficultyMin: 1000,
      });
      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain('p.id ILIKE $');
      expect(sql).toContain('p.title ILIKE $');
      expect(sql).toContain('p.categories @> ARRAY[$');
      expect(sql).toContain('p.difficulty >= $');
      // % and _ are escaped so they stay literal (ANALYSIS-007 pattern).
      expect(query.mock.calls[0][1]).toContain('%100\\% \\_x%');
    });

    it('treats the Uncategorized category filter as cardinality = 0', async () => {
      await getProblemsWithStatsForUser(1, { limit: 20, category: 'Uncategorized' });
      expect(query.mock.calls[0][0]).toContain('cardinality(p.categories) = 0');
    });

    it('rejects an out-of-range limit', async () => {
      await expect(getProblemsWithStatsForUser(1, { limit: 0 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(getProblemsWithStatsForUser(1, { limit: 101 })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('public category counts', () => {
    it('aggregates per-category counts plus totals over visible standalone problems', async () => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('unnest')) {
          return { rows: [{ name: 'Graph', count: 3 }, { name: 'Math', count: 1 }] };
        }
        return { rows: [{ total: 6, uncategorized: 2 }] };
      });

      const counts = await getPublicProblemCategoryCounts();

      expect(counts).toEqual({
        categories: [{ name: 'Graph', count: 3 }, { name: 'Math', count: 1 }],
        uncategorized: 2,
        total: 6,
      });
      const categorySql = query.mock.calls.find(([sql]) => String(sql).includes('unnest'))![0] as string;
      expect(categorySql).toContain('p.is_visible = true AND p.contest_id IS NULL');
    });
  });

  it('inserts difficulty on problem create', async () => {
    await createProblem({
      id: 'p1',
      title: 'T',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
      difficulty: 1200,
    });
    expect(query.mock.calls[0][0]).toContain('INSERT INTO problems');
    expect(query.mock.calls[0][0]).toContain('difficulty');
    expect(query.mock.calls[0][1]).toContain(1200);
  });

  it("returns 'duplicate_id' when the problem ID hits the unique constraint", async () => {
    query.mockRejectedValueOnce({ code: '23505', constraint: 'problems_pkey' });

    await expect(createProblem({
      id: 'p1',
      title: 'T',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
    })).resolves.toBe('duplicate_id');
  });

  it('rethrows non-unique-violation errors from problem create', async () => {
    const failure = new Error('connection refused');
    query.mockRejectedValueOnce(failure);

    await expect(createProblem({
      id: 'p1',
      title: 'T',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
    })).rejects.toBe(failure);
  });

  it('cascades a problem id rename to every non-FK problem_id reference (XSYS-008)', async () => {
    const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
      // SELECT (duplicate-id check) → no conflict; UPDATE problems → one row.
      if (String(sql).startsWith('SELECT')) {
        return { rows: [] };
      }
      return { rows: [{ id: 'p2' }] };
    });
    const poolConnect = db.pool.connect as unknown as jest.Mock;
    poolConnect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

    await updateProblem('p1', {
      id: 'p2',
      title: 'T',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
    });

    const cascadeTargets = [
      'contest_problems',
      'contest_submissions',
      'user_problem_rewards',
      'authoring_published_problems',
      'problem_drafts',
    ];
    for (const table of cascadeTargets) {
      const call = clientQuery.mock.calls.find(
        ([sql]) => String(sql) === `UPDATE ${table} SET problem_id = $1 WHERE problem_id = $2`,
      );
      expect(call).toBeDefined();
      expect(call![1]).toEqual(['p2', 'p1']);
    }
  });

  it('keeps difficulty tri-state on update (undefined = unchanged, null = clear)', async () => {
    const clientQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'p1' }] });
    const poolConnect = db.pool.connect as unknown as jest.Mock;
    poolConnect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

    // undefined → the difficulty branch is not applied
    await updateProblem('p1', {
      id: 'p1',
      title: 'T2',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
    });
    const unchangedSql = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE problems'))![0] as string;
    const unchangedParams = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE problems'))![1] as unknown[];
    expect(unchangedSql).toContain('difficulty = CASE WHEN $9::boolean THEN $5 ELSE difficulty END');
    expect(unchangedParams[8]).toBe(false); // difficultyProvided

    clientQuery.mockClear();

    // null → difficulty is explicitly written as NULL
    await updateProblem('p1', {
      id: 'p1',
      title: 'T2',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
      difficulty: null,
    });
    const clearedSql = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE problems'))![0] as string;
    const clearedParams = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE problems'))![1] as unknown[];
    expect(clearedParams[8]).toBe(true);
    expect(clearedParams[4]).toBeNull();

    clientQuery.mockClear();

    // a number → difficulty is written through
    await updateProblem('p1', {
      id: 'p1',
      title: 'T2',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
      difficulty: 2200,
    });
    const setParams = clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE problems'))![1] as unknown[];
    expect(setParams[8]).toBe(true);
    expect(setParams[4]).toBe(2200);
    expect(clearedSql).toContain('UPDATE problems');
  });

  it('inserts NULL difficulty when not provided on create', async () => {
    await createProblem({
      id: 'p1',
      title: 'T',
      author: 'A',
      categories: [],
      time_limit_ms: 1000,
      memory_limit_mb: 64,
    });
    expect(query.mock.calls[0][1]).toContain(null);
  });

  it('reports not_found when the PDF update matches no problem (PROBLEM-004)', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(updateProblemPdf('nope', Buffer.from('%PDF-1.4'))).resolves.toBe('not_found');

    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'p1' }] });
    await expect(updateProblemPdf('p1', Buffer.from('%PDF-1.4'))).resolves.toBe('ok');
  });
});
