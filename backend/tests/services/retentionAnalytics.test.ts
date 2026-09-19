import { getRetentionAnalytics } from '../../services/analyticsQueryService';
import * as db from '../../db';

jest.mock('../../db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

// Frozen per test run so seed and assertion compare identical timestamps.
const NOW = Date.now();
const daysAgo = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe('getRetentionAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const seed = (rows: Array<{ user_id: number; username: string; last_active: string | null; created_at: string }>) =>
    mockQuery.mockResolvedValueOnce({ rows } as never);

  it('classifies idle, active, and never-submitted users', async () => {
    seed([
      { user_id: 1, username: 'active', last_active: daysAgo(2), created_at: daysAgo(100) },
      { user_id: 2, username: 'idle', last_active: daysAgo(45), created_at: daysAgo(100) },
      { user_id: 3, username: 'ghost', last_active: null, created_at: daysAgo(10) },
    ]);

    const result = await getRetentionAnalytics(30);

    expect(result.activeUsers).toBe(1);
    expect(result.idleUsers).toEqual([
      { userId: 2, username: 'idle', lastActive: daysAgo(45) },
    ]);
    expect(result.neverSubmitted).toEqual([
      { userId: 3, username: 'ghost', createdAt: daysAgo(10) },
    ]);
  });

  it('treats a user exactly at the threshold as active', async () => {
    seed([
      { user_id: 1, username: 'edge', last_active: daysAgo(29), created_at: daysAgo(100) },
    ]);

    const result = await getRetentionAnalytics(30);

    expect(result.activeUsers).toBe(1);
    expect(result.idleUsers).toHaveLength(0);
  });

  it('sorts idle users most-recently-idle first', async () => {
    seed([
      { user_id: 1, username: 'veryOld', last_active: daysAgo(90), created_at: daysAgo(100) },
      { user_id: 2, username: 'recentlyIdle', last_active: daysAgo(40), created_at: daysAgo(100) },
    ]);

    const result = await getRetentionAnalytics(30);

    expect(result.idleUsers.map((u) => u.username)).toEqual(['recentlyIdle', 'veryOld']);
  });

  it('honours a custom idle window', async () => {
    seed([
      { user_id: 1, username: 'weekIdle', last_active: daysAgo(10), created_at: daysAgo(100) },
    ]);

    const result = await getRetentionAnalytics(7);

    expect(result.idleUsers).toHaveLength(1);
  });

  it('queries both submission pools via UNION ALL', async () => {
    seed([]);

    await getRetentionAnalytics(30);

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('FROM submissions');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('contest_submissions');
  });
});
