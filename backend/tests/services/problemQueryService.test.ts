import * as db from '../../db';
import {
  createProblem,
  getProblemsWithStatsForUser,
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
