import { getOverviewAnalytics } from '../services/analyticsQueryService';
import { SUBMISSION_STATUS } from '../constants';
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

    it('applies the time window to the top problems/submitters/contests queries (ANALYSIS-001)', async () => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [] } as never);
        await getOverviewAnalytics(30);

        // Queries 6/7/8 are topProblems, topSubmitters, contestStats.
        const [topProblemsSql, topProblemsParams] = mockQuery.mock.calls[5];
        expect(String(topProblemsSql)).toContain("WHERE s.submitted_at >= NOW() - ($1 || ' days')::interval");
        expect(topProblemsParams).toEqual([30]);

        const [topSubmittersSql, topSubmittersParams] = mockQuery.mock.calls[6];
        expect(String(topSubmittersSql)).toContain("WHERE s.submitted_at >= NOW() - ($1 || ' days')::interval");
        expect(topSubmittersParams).toEqual([30]);

        const [contestStatsSql, contestStatsParams] = mockQuery.mock.calls[7];
        expect(String(contestStatsSql)).toContain("cs.submitted_at >= NOW() - ($1 || ' days')::interval");
        expect(contestStatsParams).toEqual([30]);
    });

    it('buckets the daily series in the site timezone (ANALYSIS-002)', async () => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [] } as never);
        await getOverviewAnalytics(30);

        const dailySql = String(mockQuery.mock.calls[3][0]);
        expect(dailySql).toContain("AT TIME ZONE 'Asia/Bangkok'");
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
    listProblemsForAnalytics,
    getUserAnalytics,
    getProblemAnalytics,
} from '../services/analyticsQueryService';

describe('analyticsQueryService.listUsersForAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('passes search/limit/offset/sort as parameters and maps rows', async () => {
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

        const rows = await listUsersForAnalytics('bo', 25, 50, 'acRate', 'asc');

        expect(mockQuery.mock.calls[0][1]).toEqual(['bo', 25, 50]);
        expect(String(mockQuery.mock.calls[0][0])).toContain('ac_rate ASC');
        // Regression guard: the Accepted literal must stay a quoted SQL string
        // (an unquoted ${SUBMISSION_STATUS.ACCEPTED} becomes a bare identifier
        // and Postgres rejects it with 42703 at runtime).
        expect(String(mockQuery.mock.calls[0][0])).toContain(`'${SUBMISSION_STATUS.ACCEPTED}'`);
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

        // ANALYSIS-002/SCORE-006: day and hour buckets use the site timezone,
        // matching the contest scheduler, not the DB session (UTC).
        // Query order: user lookup (0), KPIs (1), daily (2), hour (3).
        const dailySql = String(mockQuery.mock.calls[2][0]);
        expect(dailySql).toContain("date_trunc('day', submitted_at AT TIME ZONE 'Asia/Bangkok')");
        const hourSql = String(mockQuery.mock.calls[3][0]);
        expect(hourSql).toContain("EXTRACT(HOUR FROM submitted_at AT TIME ZONE 'Asia/Bangkok')");
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


describe('analyticsQueryService.listProblemsForAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns problems with stats mapped to camelCase', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                problem_id: 'aplusb',
                title: 'A Plus B',
                categories: ['Math'],
                submissions: '30',
                accepted: '20',
                ac_rate: '0.667',
                solvers: '8',
            }],
        } as never);

        const rows = await listProblemsForAnalytics('', 50, 0);

        expect(mockQuery.mock.calls[0][1]).toEqual(['', 50, 0]);
        expect(rows).toEqual([{
            problemId: 'aplusb',
            title: 'A Plus B',
            categories: ['Math'],
            submissions: 30,
            accepted: 20,
            acRate: 0.667,
            solvers: 8,
        }]);
    });

    it('sorts by the requested column and direction', async () => {
        mockQuery.mockResolvedValue({ rows: [] } as never);

        await listProblemsForAnalytics('', 50, 0, 'acRate', 'asc');

        expect(String(mockQuery.mock.calls[0][0])).toContain('ac_rate ASC');
    });
});

// ---------------------------------------------------------------------------
// Submission list with filters
// ---------------------------------------------------------------------------

import { listSubmissionsForAnalytics, SubmissionFilters } from '../services/analyticsQueryService';

describe('analyticsQueryService.listSubmissionsForAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns submissions mapped to camelCase', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 42,
                source: 'main',
                problem_id: 'aplusb',
                problem_title: 'A Plus B',
                user_id: 2,
                username: 'bob',
                overall_status: 'Accepted',
                score: 100,
                language: 'cpp',
                max_time_ms: 12,
                max_memory_kb: 4096,
                submitted_at: '2026-09-19T05:00:00+00:00',
            }],
        } as never);

        const rows = await listSubmissionsForAnalytics({}, 50, 0);

        expect(rows).toEqual([{
            id: 42,
            source: 'main',
            problemId: 'aplusb',
            problemTitle: 'A Plus B',
            userId: 2,
            username: 'bob',
            verdict: 'Accepted',
            score: 100,
            language: 'cpp',
            timeMs: 12,
            memoryKb: 4096,
            submittedAt: '2026-09-19T05:00:00+00:00',
        }]);
    });

    it('applies problem and user filters as parameters', async () => {
        mockQuery.mockResolvedValue({ rows: [] } as never);

        const filters: SubmissionFilters = { problemId: 'aplusb', userId: 2 };
        await listSubmissionsForAnalytics(filters, 25, 50);

        const [sql, params] = mockQuery.mock.calls[0];
        expect(params).toEqual(['aplusb', 2, 25, 50]);
        expect(String(sql)).toContain('problem_id = $1');
        expect(String(sql)).toContain('user_id = $2');
    });

    it('omits absent filters from the WHERE clause', async () => {
        mockQuery.mockResolvedValue({ rows: [] } as never);

        await listSubmissionsForAnalytics({}, 50, 0);

        const [sql, params] = mockQuery.mock.calls[0];
        expect(params).toEqual([50, 0]);
        expect(String(sql)).not.toContain('problem_id = $');
        expect(String(sql)).not.toContain('user_id = $');
    });

    it('filters by verdict when provided', async () => {
        mockQuery.mockResolvedValue({ rows: [] } as never);

        await listSubmissionsForAnalytics({ verdict: 'Accepted' }, 50, 0);

        const [sql, params] = mockQuery.mock.calls[0];
        expect(params).toEqual(['Accepted', 50, 0]);
        expect(String(sql)).toContain('overall_status = $1');
    });
});
