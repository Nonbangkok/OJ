import { findSimilarContestPairs, SIMILARITY_THRESHOLD } from '../../services/similarityService';
import * as db from '../../db';

jest.mock('../../db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

const solutionA = `#include <iostream>
int main() { long long total = 0; for (int i = 1; i <= 100; i++) total += i * i;
std::cout << total << std::endl; return 0; }`;

const solutionARenamed = `#include <iostream>
int main() { long long sumAcc = 0; for (int k = 1; k <= 100; k++) sumAcc += k * k;
std::cout << sumAcc << std::endl; return 0; }`;

const solutionB = `#include <iostream>
int main() { std::string s; std::getline(std::cin, s); std::reverse(s.begin(), s.end());
std::cout << s << std::endl; return 0; }`;

const rows = (...submissions: Array<{ id: number; user_id: number; username: string; problem_id: string; code: string }>) =>
  ({ rows: submissions });

describe('similarityService.findSimilarContestPairs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports renamed-copy pairs above the threshold', async () => {
    mockQuery.mockResolvedValueOnce(rows(
      { id: 1, user_id: 1, username: 'alice', problem_id: 'aplusb', code: solutionA },
      { id: 2, user_id: 2, username: 'bob', problem_id: 'aplusb', code: solutionARenamed },
    ) as never);

    const pairs = await findSimilarContestPairs(5);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      problemId: 'aplusb',
      userA: 'alice',
      userB: 'bob',
      submissionIdA: 1,
      submissionIdB: 2,
    });
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it('does not report genuinely different solutions', async () => {
    mockQuery.mockResolvedValueOnce(rows(
      { id: 1, user_id: 1, username: 'alice', problem_id: 'aplusb', code: solutionA },
      { id: 2, user_id: 2, username: 'bob', problem_id: 'aplusb', code: solutionB },
    ) as never);

    const pairs = await findSimilarContestPairs(5);

    expect(pairs).toHaveLength(0);
  });

  it('skips self-comparisons for users with multiple problems', async () => {
    mockQuery.mockResolvedValueOnce(rows(
      { id: 1, user_id: 1, username: 'alice', problem_id: 'p1', code: solutionA },
      { id: 2, user_id: 1, username: 'alice', problem_id: 'p2', code: solutionA },
    ) as never);

    const pairs = await findSimilarContestPairs(5);

    expect(pairs).toHaveLength(0);
  });

  it('skips submissions from users with null ids or empty code', async () => {
    mockQuery.mockResolvedValueOnce(rows(
      { id: 1, user_id: null, username: 'anon', problem_id: 'p1', code: solutionA } as never,
      { id: 2, user_id: 2, username: 'bob', problem_id: 'p1', code: '' },
    ) as never);

    const pairs = await findSimilarContestPairs(5);

    expect(pairs).toHaveLength(0);
  });

  it('honours a custom threshold', async () => {
    mockQuery.mockResolvedValueOnce(rows(
      { id: 1, user_id: 1, username: 'alice', problem_id: 'p1', code: solutionA },
      { id: 2, user_id: 2, username: 'bob', problem_id: 'p1', code: solutionARenamed },
    ) as never);

    const pairs = await findSimilarContestPairs(5, 1.1); // impossible threshold

    expect(pairs).toHaveLength(0);
  });

  it('queries by contest id with latest-per-user-problem ordering', async () => {
    mockQuery.mockResolvedValueOnce(rows() as never);

    await findSimilarContestPairs(42);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(String(mockQuery.mock.calls[0][0])).toContain('cs.contest_id = $1');
    expect(mockQuery.mock.calls[0][1]).toEqual([42]);
  });
});
