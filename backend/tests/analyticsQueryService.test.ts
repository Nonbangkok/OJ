import { getOverviewAnalytics } from '../services/analyticsQueryService';
import * as db from '../db';

jest.mock('../db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('analyticsQueryService.getOverviewAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns KPIs with current/previous windows mapped to camelCase', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                current_submissions: '100',
                previous_submissions: '80',
                current_submitters: '10',
                previous_submitters: '8',
                current_accepted: '60',
                previous_accepted: '40',
            }],
        } as never)
            .mockResolvedValueOnce({ rows: [{ current_users: '5', previous_users: '3' }] } as never)
            .mockResolvedValueOnce({ rows: [{ current_problems: '2', previous_problems: '1' }] } as never)
            .mockResolvedValueOnce({
                rows: [
                    { day: '2026-09-18', total: '12', accepted: '7' },
                    { day: '2026-09-19', total: '10', accepted: '6' },
                ],
            } as never)
            .mockResolvedValueOnce({ rows: [{ verdict: 'Accepted', count: '60' }, { verdict: 'Wrong Answer', count: '40' }] } as never)
            .mockResolvedValueOnce({ rows: [{ problem_id: 'aplusb', title: 'A Plus B', submissions: '30', accepted: '20' }] } as never)
            .mockResolvedValueOnce({ rows: [{ user_id: 1, username: 'alice', submissions: '15', solved: '5' }] } as never)
            .mockResolvedValueOnce({ rows: [{ contest_id: 1, title: 'Contest 1', status: 'finished', submissions: '40', participants: '8', avg_score: '250.5' }] } as never);

        const result = await getOverviewAnalytics(30);

        expect(result.kpis.submissions).toEqual({ current: 100, previous: 80 });
        expect(result.kpis.uniqueSubmitters).toEqual({ current: 10, previous: 8 });
        expect(result.kpis.accepted).toEqual({ current: 60, previous: 40 });
        expect(result.kpis.newUsers).toEqual({ current: 5, previous: 3 });
        expect(result.kpis.newProblems).toEqual({ current: 2, previous: 1 });
        expect(result.dailySeries).toEqual([
            { day: '2026-09-18', total: 12, accepted: 7 },
            { day: '2026-09-19', total: 10, accepted: 6 },
        ]);
        expect(result.verdictBreakdown).toEqual([
            { verdict: 'Accepted', count: 60 },
            { verdict: 'Wrong Answer', count: 40 },
        ]);
        expect(result.topProblems).toEqual([
            { problemId: 'aplusb', title: 'A Plus B', submissions: 30, accepted: 20 },
        ]);
        expect(result.topSubmitters).toEqual([
            { userId: 1, username: 'alice', submissions: 15, solved: 5 },
        ]);
        expect(result.contestStats).toEqual([
            { contestId: 1, title: 'Contest 1', status: 'finished', submissions: 40, participants: 8, avgScore: 250.5 },
        ]);
        expect(mockQuery).toHaveBeenCalledTimes(8);
    });

    it('passes the days window as parameterized query params', async () => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [] } as never);
        await getOverviewAnalytics(7);
        const firstCall = mockQuery.mock.calls[0];
        expect(firstCall[1]).toEqual([7, 14]);
        expect(String(firstCall[0])).toContain('$1');
        expect(String(firstCall[0])).toContain('UNION ALL');
    });

    it('defaults avg_score to 0 when null', async () => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [{ contest_id: 2, title: 'C2', status: 'running', submissions: '1', participants: '1', avg_score: null }] } as never);

        const result = await getOverviewAnalytics(30);
        expect(result.contestStats).toEqual([
            { contestId: 2, title: 'C2', status: 'running', submissions: 1, participants: 1, avgScore: 0 },
        ]);
    });
});
