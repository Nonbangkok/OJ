import { getUserProfileStats } from '../services/userProfileQueryService';

/**
 * These tests pin the SQL contract against the empty-user regression: an
 * early version joined the user_submissions CTE with `LEFT JOIN ... ON true`
 * and counted rows of that join, which reports one phantom submission for a
 * user with no submissions. The service must aggregate from the CTE itself.
 */
describe('getUserProfileStats SQL shape', () => {
  it('aggregates from the CTE without a row-multiplying join', () => {
    // Read the source and assert the query never joins on a literal `true`
    // against the user_submissions CTE — the contract the DB-level behavior
    // depends on. A full integration test covers the numbers on a real stack.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'userProfileQueryService.ts'),
      'utf8',
    );

    expect(source).not.toContain('LEFT JOIN user_submissions us ON true');
    expect(source).toContain('FROM user_submissions');
  });

  it('buckets daily activity in the site timezone (ANALYSIS-002/SCORE-006)', () => {
    // The heatmap must use the same zone as the streak computation and the
    // contest scheduler (Asia/Bangkok), not the DB session default (UTC).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'userProfileQueryService.ts'),
      'utf8',
    );

    expect(source).toContain("(submitted_at AT TIME ZONE '${ANALYTICS_TIMEZONE}')");
    // The old UTC-dependent cast must be gone.
    expect(source).not.toContain('submitted_at::date');
  });
});
