import * as db from '../../db';
import { getUserProfileStats } from '../../services/userProfileQueryService';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

// Progression is a separate concern covered by its own tests; the stats
// tests only exercise the streak/achievement SQL, so keep progression fixed.
jest.mock('../../services/progressionService', () => ({
  getUserProgression: jest.fn().mockResolvedValue({
    totalXp: 0,
    level: 1,
    tier: 'Novice',
    levelProgress: { current: 0, required: 100, remaining: 100, percentage: 0 },
    globalRank: null,
  }),
  getRecentRewards: jest.fn().mockResolvedValue([]),
}));

const query = db.query as jest.Mock;

const baseRow = {
  id: 3,
  username: 'tester',
  role: 'user',
  has_avatar: false,
  avatar_updated_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  problems_attempted: 4,
  problems_solved: 2,
  total_score: 250,
  submission_count: 9,
  verdict_counts: { Accepted: 3, 'Wrong Answer': 5 },
  language_counts: { cpp: 9 },
  daily_activity: [{ day: '2026-09-18', count: 2 }],
  ac_days: [] as string[],
  languages_solved_in: {} as Record<string, number>,
  contests_joined: 0,
  today: '2026-09-21',
};

describe('getUserProfileStats streaks and achievements', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ ...baseRow }] });
  });

  it('pins the day boundary to Asia/Bangkok in both the AC-day extraction and "today"', async () => {
    await getUserProfileStats('tester');
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("AT TIME ZONE 'Asia/Bangkok'");
  });

  it('returns zero streaks and no unlocks for a user without AC history', async () => {
    query.mockResolvedValue({
      rows: [{ ...baseRow, problems_solved: 0, total_score: 0 }],
    });
    const stats = await getUserProfileStats('tester');
    expect(stats?.current_streak).toBe(0);
    expect(stats?.longest_streak).toBe(0);
    expect(stats?.last_ac_date).toBeNull();
    expect(stats?.achievements.unlocked).toEqual([]);
    expect(stats?.achievements.stats).toEqual({
      problemsSolved: 0,
      currentStreak: 0,
      longestStreak: 0,
      languagesSolvedIn: {},
      contestsJoined: 0,
    });
  });

  it('derives streaks from the AC-day list and unlocks matching achievements', async () => {
    query.mockResolvedValue({
      rows: [{
        ...baseRow,
        problems_solved: 10,
        ac_days: ['2026-09-19', '2026-09-20', '2026-09-21'],
        languages_solved_in: { cpp: 9, python: 1 },
        contests_joined: 2,
      }],
    });

    const stats = await getUserProfileStats('tester');
    expect(stats?.current_streak).toBe(3);
    expect(stats?.longest_streak).toBe(3);
    expect(stats?.last_ac_date).toBe('2026-09-21');
    expect(stats?.achievements.stats).toEqual({
      problemsSolved: 10,
      currentStreak: 3,
      longestStreak: 3,
      languagesSolvedIn: { cpp: 9, python: 1 },
      contestsJoined: 2,
    });
    const unlockedIds = stats?.achievements.unlocked.map((a) => a.id);
    expect(unlockedIds).toEqual(['first_solve', 'ten_solves', 'polyglot', 'contester']);
  });

  it('exposes name and description with each unlock, never the check function', async () => {
    query.mockResolvedValue({
      rows: [{
        ...baseRow,
        problems_solved: 1,
        ac_days: ['2026-09-21'],
        languages_solved_in: { cpp: 1 },
      }],
    });

    const stats = await getUserProfileStats('tester');
    expect(stats?.achievements.unlocked).toEqual([
      { id: 'first_solve', name: 'First Solve', description: 'Solve your first problem' },
    ]);
    // The payload must stay JSON-serializable.
    expect(JSON.parse(JSON.stringify(stats?.achievements))).toEqual(stats?.achievements);
  });

  it('keeps a streak that ended yesterday current', async () => {
    query.mockResolvedValue({
      rows: [{ ...baseRow, ac_days: ['2026-09-20'] }],
    });

    const stats = await getUserProfileStats('tester');
    expect(stats?.current_streak).toBe(1);
    expect(stats?.last_ac_date).toBe('2026-09-20');
  });
});
