import { awardSolveReward, backfillSolveRewards, getUserProgression } from '../services/progressionService';
import { query } from '../db';

jest.mock('../db', () => ({
    query: jest.fn(),
}));

const mockedQuery = query as jest.Mock;

describe('awardSolveReward', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('awards XP computed from the problem difficulty on first solve', async () => {
        mockedQuery
            .mockResolvedValueOnce({ rows: [{ difficulty: 1400 }] }) // problem lookup
            .mockResolvedValueOnce({ rows: [{ xp_awarded: 46 }] }); // insert

        const xp = await awardSolveReward(7, 'prob1');

        expect(xp).toBe(46);
        const insertCall = mockedQuery.mock.calls[1];
        expect(String(insertCall[0])).toContain('ON CONFLICT (user_id, problem_id) DO NOTHING');
        // Snapshot and XP are both persisted.
        expect(insertCall[1]).toEqual([7, 'prob1', 46, 1400, expect.any(Date)]);
    });

    it('awards the unrated fallback when the problem has no difficulty', async () => {
        mockedQuery
            .mockResolvedValueOnce({ rows: [{ difficulty: null }] })
            .mockResolvedValueOnce({ rows: [{ xp_awarded: 10 }] });

        const xp = await awardSolveReward(7, 'prob2');

        expect(xp).toBe(10);
        expect(mockedQuery.mock.calls[1][1]).toEqual([7, 'prob2', 10, null, expect.any(Date)]);
    });

    it('returns 0 XP when the reward already exists (conflict)', async () => {
        mockedQuery
            .mockResolvedValueOnce({ rows: [{ difficulty: 1200 }] })
            .mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING -> no row

        const xp = await awardSolveReward(7, 'prob1');

        expect(xp).toBe(0);
    });

    it('returns 0 XP when the problem no longer exists', async () => {
        mockedQuery.mockResolvedValueOnce({ rows: [] });

        const xp = await awardSolveReward(7, 'gone');

        expect(xp).toBe(0);
        expect(mockedQuery).toHaveBeenCalledTimes(1);
    });
});

describe('getUserProgression', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('derives level/tier/progress from total XP and computes the dense rank', async () => {
        // 1270 XP -> level 4 (900..1600), Novice tier (levels 1-4)
        mockedQuery
            .mockResolvedValueOnce({ rows: [{ total_xp: '1270' }] })
            .mockResolvedValueOnce({ rows: [{ rank: 3 }] });

        const progression = await getUserProgression(7);

        expect(progression).toEqual({
            totalXp: 1270,
            level: 4,
            tier: 'Novice',
            levelProgress: { current: 370, required: 700, remaining: 330, percentage: 53 },
            globalRank: 3,
        });
        // Dense rank over per-user sums, best total first.
        expect(String(mockedQuery.mock.calls[1][0])).toContain('DENSE_RANK() OVER (ORDER BY total_xp DESC)');
    });

    it('gives no rank and level 1 to a user with no rewards', async () => {
        mockedQuery
            .mockResolvedValueOnce({ rows: [{ total_xp: '0' }] })
            .mockResolvedValueOnce({ rows: [] });

        const progression = await getUserProgression(8);

        expect(progression.totalXp).toBe(0);
        expect(progression.level).toBe(1);
        expect(progression.tier).toBe('Novice');
        expect(progression.globalRank).toBeNull();
    });
});

describe('backfillSolveRewards', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('inserts one reward per unique first solve and stays idempotent', async () => {
        mockedQuery.mockResolvedValueOnce({ rows: [{ inserted: 12 }] });

        const inserted = await backfillSolveRewards();

        expect(inserted).toBe(12);
        const sql = String(mockedQuery.mock.calls[0][0]);
        // Both submission pools are scanned...
        expect(sql).toContain('FROM submissions');
        expect(sql).toContain('FROM contest_submissions');
        // ...only Accepted verdicts count...
        expect(sql).toContain("overall_status = 'Accepted'");
        // ...the first Accepted timestamp is used...
        expect(sql).toContain('MIN(submitted_at)');
        // ...and reruns can't duplicate.
        expect(sql).toContain('ON CONFLICT (user_id, problem_id) DO NOTHING');
    });
});
