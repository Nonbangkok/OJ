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
            .mockResolvedValueOnce({ rows: [{ current_users: '2', previous_users: '1' }] } as never)
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
        expect(result.kpis.activeProblems).toEqual({ current: 2, previous: 1 });
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

// ---------------------------------------------------------------------------
// Task 2: per-user and per-problem analytics
// ---------------------------------------------------------------------------

import {
    listUsersForAnalytics,
    getUserAnalytics,
    getProblemAnalytics,
} from '../services/analyticsQueryService';

describe('analyticsQueryService.listUsersForAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('passes search/limit/offset as parameters and maps rows', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                user_id: 2,
                username: 'bob',
                role: 'user',
                submissions: '20',
                solved: '4',
                ac_rate: '0.5',
                last_active: '2026-09-19T10:00:00Z',
            }],
        } as never);

        const rows = await listUsersForAnalytics('bo', 25, 50);

        expect(mockQuery.mock.calls[0][1]).toEqual(['bo', 25, 50]);
        expect(rows).toEqual([{
            userId: 2,
            username: 'bob',
            role: 'user',
            submissions: 20,
            solved: 4,
            acRate: 0.5,
            lastActive: '2026-09-19T10:00:00Z',
        }]);
    });
});

describe('analyticsQueryService.getUserAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null when the user does not exist', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] } as never);

        const result = await getUserAnalytics(999);

        expect(result).toBeNull();
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('aggregates the full user analytics payload', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 2, username: 'bob', role: 'user', created_at: '2026-01-01T00:00:00Z' }],
        } as never)
            .mockResolvedValueOnce({
                rows: [{
                    submissions: '20',
                    attempted: '10',
                    solved: '4',
                    ac_rate: '0.2',
                    total_score: '400',
                }],
            } as never)
            .mockResolvedValueOnce({ rows: [{ day: '2026-09-19', count: '3' }] } as never)
            .mockResolvedValueOnce({ rows: [{ hour: '14', count: '5' }] } as never)
            .mockResolvedValueOnce({ rows: [{ verdict: 'Accepted', count: '4' }] } as never)
            .mockResolvedValueOnce({ rows: [{ language: 'cpp', count: '20' }] } as never)
            .mockResolvedValueOnce({ rows: [{ day: '2026-09-19', solved: '4' }] } as never)
            .mockResolvedValueOnce({ rows: [{ category: 'math', solved: '3', attempted: '5' }] } as never);

        const result = await getUserAnalytics(2);

        expect(result?.user).toEqual({ id: 2, username: 'bob', role: 'user', createdAt: '2026-01-01T00:00:00Z' });
        expect(result?.kpis).toEqual({ submissions: 20, attempted: 10, solved: 4, acRate: 0.2, totalScore: 400 });
        expect(result?.dailySeries).toEqual([{ day: '2026-09-19', count: 3 }]);
        expect(result?.hourHistogram).toEqual([{ hour: 14, count: 5 }]);
        expect(result?.verdictBreakdown).toEqual([{ verdict: 'Accepted', count: 4 }]);
        expect(result?.languageBreakdown).toEqual([{ language: 'cpp', count: 20 }]);
        expect(result?.cumulativeSolved).toEqual([{ day: '2026-09-19', solved: 4 }]);
        expect(result?.solvedByCategory).toEqual([{ category: 'math', solved: 3, attempted: 5 }]);
    });
});

describe('analyticsQueryService.getProblemAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null when the problem does not exist', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] } as never);

        const result = await getProblemAnalytics('missing');

        expect(result).toBeNull();
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('computes testcase pass rates from the results JSONB aggregation', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 'aplusb', title: 'A Plus B' }],
        } as never)
            .mockResolvedValueOnce({
                rows: [{ submissions: '10', accepted: '7', ac_rate: '0.7', unique_submitters: '5' }],
            } as never)
            .mockResolvedValueOnce({ rows: [{ day: '2026-09-19', total: '2', accepted: '1' }] } as never)
            .mockResolvedValueOnce({ rows: [{ verdict: 'Accepted', count: '7' }] } as never)
            .mockResolvedValueOnce({
                rows: [{ case_number: 3, total: '10', passed: '7' }],
            } as never)
            .mockResolvedValueOnce({ rows: [{ bucket: '0-100ms', count: '4' }] } as never)
            .mockResolvedValueOnce({ rows: [{ bucket: '0-50MB', count: '4' }] } as never)
            .mockResolvedValueOnce({
                rows: [{ user_id: 2, username: 'bob', submitted_at: '2026-02-01T00:00:00Z' }],
            } as never);

        const result = await getProblemAnalytics('aplusb');

        expect(result?.problem).toEqual({ id: 'aplusb', title: 'A Plus B' });
        expect(result?.kpis).toEqual({ submissions: 10, accepted: 7, acRate: 0.7, uniqueSubmitters: 5 });
        expect(result?.testcasePassRates).toEqual([{ caseNumber: 3, passRate: 0.7 }]);
        expect(result?.runtimeBuckets).toEqual([{ bucket: '0-100ms', count: 4 }]);
        expect(result?.memoryBuckets).toEqual([{ bucket: '0-50MB', count: 4 }]);
        expect(result?.firstSolves).toEqual([{ userId: 2, username: 'bob', submittedAt: '2026-02-01T00:00:00Z' }]);
    });
});

// ---------------------------------------------------------------------------
// Per-contest analytics
// ---------------------------------------------------------------------------

import { getContestAnalytics } from '../services/analyticsQueryService';

describe('analyticsQueryService.getContestAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null when the contest does not exist', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] } as never);

        const result = await getContestAnalytics(999);

        expect(result).toBeNull();
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('aggregates the full contest analytics payload', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                contest_id: 1,
                title: 'Test Contest',
                status: 'finished',
                start_time: '2026-09-01T08:00:00+00:00',
                end_time: '2026-09-01T11:00:00+00:00',
            }],
        } as never)
            .mockResolvedValueOnce({
                rows: [{
                    participants: '8',
                    submitters: '5',
                    submissions: '40',
                    accepted: '25',
                    avg_score: '250.5',
                    max_score: '400',
                }],
            } as never)
            .mockResolvedValueOnce({
                rows: [{ bucket: '0-1h', count: '20' }, { bucket: '1-2h', count: '20' }],
            } as never)
            .mockResolvedValueOnce({
                rows: [{ problem_id: 'aplusb', title: 'A Plus B', submissions: '20', accepted: '15', ac_rate: '0.75', solvers: '4' }],
            } as never)
            .mockResolvedValueOnce({
                rows: [{ username: 'bob', total_score: '300', solved: '3' }],
            } as never);

        const result = await getContestAnalytics(1);

        expect(result?.contest).toEqual({
            contestId: 1,
            title: 'Test Contest',
            status: 'finished',
            startTime: '2026-09-01T08:00:00+00:00',
            endTime: '2026-09-01T11:00:00+00:00',
        });
        expect(result?.kpis).toEqual({
            participants: 8,
            submitters: 5,
            submissions: 40,
            accepted: 25,
            avgScore: 250.5,
            maxScore: 400,
        });
        expect(result?.submissionTimeline).toEqual([
            { bucket: '0-1h', count: 20 },
            { bucket: '1-2h', count: 20 },
        ]);
        expect(result?.problemStats).toEqual([
            { problemId: 'aplusb', title: 'A Plus B', submissions: 20, accepted: 15, acRate: 0.75, solvers: 4 },
        ]);
        expect(result?.scoreboard).toEqual([
            { username: 'bob', totalScore: 300, solved: 3 },
        ]);
    });
});
