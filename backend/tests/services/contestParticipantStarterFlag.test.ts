import * as db from '../../db';
import { getContestProblemDetailForParticipant } from '../../services/contestParticipantQueryService';

jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../services/contestAccess', () => ({
  getContestById: jest.fn(),
  isContestParticipant: jest.fn(),
  isContestManagementRole: jest.fn(() => false),
}));

const query = db.query as jest.Mock;
const { getContestById, isContestParticipant } = jest.requireMock('../../services/contestAccess') as {
  getContestById: jest.Mock;
  isContestParticipant: jest.Mock;
};

/**
 * `has_starter_files` is a HEADER-only flag: the public starter-ZIP route 404s
 * standard problems, so a standard problem that still carries starter files
 * (the switch header -> standard deliberately keeps them) must not advertise a
 * download. The filter is asserted on the SQL of both branches; the finished
 * branch also runs end-to-end in
 * tests/integration/finishedContestProblemDetail.test.ts. In the finished
 * branch the live-problem gate (A5-06) may sit between the two.
 */
describe('contest problem detail starter flag is header-only', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isContestParticipant.mockResolvedValue(true);
    query.mockResolvedValue({ rows: [{ id: 'P1' }] });
  });

  it.each([
    ['running', 'FROM problems'],
    ['finished', 'FROM contest_problems'],
  ])('filters the starter EXISTS on problem_type for a %s contest', async (status, fromClause) => {
    getContestById.mockResolvedValue({ id: 1, status, is_visible: true });

    await getContestProblemDetailForParticipant('1', 'P1', 7);

    const sql = String(query.mock.calls.at(-1)![0]);
    expect(sql).toContain(fromClause);
    expect(sql).toContain("AS has_starter_files");
    // The EXISTS must be conjoined with a header check, never stand alone.
    expect(sql).toMatch(/problem_type(?:,\s*'standard'\))?\s*=\s*'header'\s+AND\s+(?:\(p\.contest_id IS NULL OR \$3::boolean\)\s+AND\s+)?EXISTS \(SELECT 1 FROM problem_files/);
  });
});
