import { getSubmissions, searchProblems, searchUsers, validateAndQueueSubmission } from '../../services/submissionQueryService';
import * as db from '../../db';

jest.mock('../../db');

const query = db.query as jest.Mock;

describe('submissionQueryService visibility (PROBLEM-001 / SUB-001 / SUB-002)', () => {
    beforeEach(() => {
        query.mockReset();
        query.mockResolvedValue({ rows: [] });
    });

    describe('getSubmissions general feed', () => {
        it('filters hidden and contest problems out for regular users', async () => {
            await getSubmissions({ filter: 'all' }, 5, false);

            const [sql] = query.mock.calls[0];
            expect(sql).toContain('p.is_visible = true AND p.contest_id IS NULL');
        });

        it('applies the same visibility predicate for guests (PUBLIC mode feed)', async () => {
            await getSubmissions({}, 0, false);

            const [sql] = query.mock.calls[0];
            expect(sql).toContain('p.is_visible = true AND p.contest_id IS NULL');
        });

        it('keeps the unfiltered feed for staff/admin', async () => {
            await getSubmissions({ filter: 'all' }, 1, true);

            const [sql] = query.mock.calls[0];
            expect(sql).not.toContain('is_visible');
        });

        it('still scopes "mine" submissions with the visibility predicate for users', async () => {
            await getSubmissions({ filter: 'mine' }, 5, false);

            const [sql, params] = query.mock.calls[0];
            expect(sql).toContain('p.is_visible = true AND p.contest_id IS NULL');
            expect(sql).toContain('s.user_id = $1');
            expect(params).toEqual([5]);
        });

        it('pages past the 200-row cap with an OFFSET (SUB-004)', async () => {
            await getSubmissions({ page: 1 }, 5, false);
            const [sqlPage1] = query.mock.calls[0];
            expect(sqlPage1).toContain('OFFSET 0');

            await getSubmissions({ page: 3 }, 5, false);
            const [sqlPage3] = query.mock.calls[1];
            // (3 - 1) * 200 = 400 skipped rows.
            expect(sqlPage3).toContain('OFFSET 400');
            expect(sqlPage3).toContain('LIMIT 200');
        });

        it('treats a missing page as page 1 (default behavior preserved, SUB-004)', async () => {
            await getSubmissions({}, 5, false);

            const [sql] = query.mock.calls[0];
            expect(sql).toContain('OFFSET 0');
        });
    });

    describe('getSubmissions contest feed', () => {
        it('throws 403 for a non-participant of a running contest', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: true }] })
                .mockResolvedValueOnce({ rows: [] }); // participant check: no

            await expect(getSubmissions({ contestId: '3' }, 5, false)).rejects.toMatchObject({
                statusCode: 403,
            });
        });

        it('throws 403 for a non-participant even when the contest is finished', async () => {
            // SUB-002: the PUBLIC-mode policy opened frozen scoreboard
            // results, not per-submission feeds — finished contests keep the
            // same participant gate.
            query
                .mockResolvedValueOnce({ rows: [{ status: 'finished', is_visible: true }] })
                .mockResolvedValueOnce({ rows: [] }); // participant check: no

            await expect(getSubmissions({ contestId: '3' }, 5, false)).rejects.toMatchObject({
                statusCode: 403,
            });
        });

        it('throws 404 when the contest does not exist', async () => {
            query.mockResolvedValueOnce({ rows: [] });

            await expect(getSubmissions({ contestId: '999' }, 5, false)).rejects.toMatchObject({
                statusCode: 404,
            });
        });

        it('returns rows for a participant without running a participant query for staff', async () => {
            const rows = [{ id: 1, username: 'u1', problem_id: 'CP1' }];
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: true }] })
                .mockResolvedValueOnce({ rows }); // feed query (no participant check for staff)

            const result = await getSubmissions({ contestId: '3' }, 1, true);

            expect(result).toEqual(rows);
            expect(query).toHaveBeenCalledTimes(2);
        });

        it('reads a hidden contest feed as 404 for a non-staff user', async () => {
            query.mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: false }] });

            await expect(getSubmissions({ contestId: '3' }, 5, false)).rejects.toMatchObject({
                statusCode: 404,
                message: 'Contest not found.',
            });
        });

        it('serves a hidden contest feed to staff even without participation', async () => {
            const rows = [{ id: 1, username: 'u1', problem_id: 'CP1' }];
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: false }] })
                .mockResolvedValueOnce({ rows });

            const result = await getSubmissions({ contestId: '3' }, 1, true);

            expect(result).toEqual(rows);
        });
    });

    describe('searchProblems', () => {
        it('restricts the default branch to visible non-contest problems for users', async () => {
            await searchProblems('grind', { userId: 5, role: 'user' });

            const [sql, params] = query.mock.calls[0];
            expect(sql).toContain('is_visible = true AND contest_id IS NULL');
            expect(params).toEqual(['%grind%']);
        });

        it('keeps the full-catalog search for staff', async () => {
            await searchProblems('grind', { userId: 1, role: 'staff' });

            const [sql] = query.mock.calls[0];
            expect(sql).not.toContain('is_visible');
        });

        it('returns no contest problems for a non-participant of a running contest', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: true }] })
                .mockResolvedValueOnce({ rows: [] }); // participant check: no

            const result = await searchProblems('aplusb', { userId: 5, role: 'user' }, '1');

            expect(result).toEqual([]);
            expect(query).toHaveBeenCalledTimes(2);
        });

        it('returns contest problems to a participant of a running contest', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: true }] })
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // participant check: yes
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] });

            const result = await searchProblems('aplusb', { userId: 5, role: 'user' }, '1');

            expect(result).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
        });

        it('skips the participant check for staff', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: true }] })
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] });

            const result = await searchProblems('aplusb', { userId: 1, role: 'admin' }, '1');

            expect(result).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
            expect(query).toHaveBeenCalledTimes(2);
        });

        it('returns nothing for a hidden contest even for a participant', async () => {
            query.mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: false }] });

            const result = await searchProblems('aplusb', { userId: 5, role: 'user' }, '1');

            expect(result).toEqual([]);
            expect(query).toHaveBeenCalledTimes(1);
        });

        it('keeps full contest problem search for staff on a hidden contest', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: false }] })
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] });

            const result = await searchProblems('aplusb', { userId: 1, role: 'staff' }, '1');

            expect(result).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
        });
    });

    describe('searchUsers', () => {
        it('returns no participants of a hidden contest for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: false }] });

            const result = await searchUsers('alice', '1', false);

            expect(result).toEqual([]);
            expect(query).toHaveBeenCalledTimes(1);
        });

        it('returns participants of a hidden contest for staff', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ id: 7, username: 'alice' }] });

            const result = await searchUsers('alice', '1', true);

            expect(result).toEqual([{ id: 7, username: 'alice' }]);
            // No visibility pre-check for staff — straight to the user query.
            expect(String(query.mock.calls[0][0])).toContain('contest_participants');
        });

        it('returns participants of a visible contest for a normal user', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: true }] })
                .mockResolvedValueOnce({ rows: [{ id: 7, username: 'alice' }] });

            const result = await searchUsers('alice', '1', false);

            expect(result).toEqual([{ id: 7, username: 'alice' }]);
        });
    });

    describe('validateAndQueueSubmission contest wall-clock gate (XSYS-003 / CONTEST-001)', () => {
        const payload = {
            problemId: 'CP1',
            language: 'cpp' as const,
            code: 'int main(){}',
            contestId: '1',
        };
        const contestRow = (start: Date, end: Date) => ({
            id: 1, status: 'running', start_time: start, end_time: end,
        });

        it('accepts a submission while the contest is genuinely inside its window', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] })  // testcase exists (DB-06)
                .mockResolvedValueOnce({ rows: [contestRow(new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000))] })
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] })  // participant
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] })  // problem in contest
                .mockResolvedValueOnce({ rows: [{ id: 202 }] });   // insert

            const result = await validateAndQueueSubmission(payload, 5);

            expect(result).toEqual({ submissionId: 202, isContestSubmission: true });
        });

        it('rejects a submission after end_time even while status is still running (end_time+ε)', async () => {
            // The scheduler has not ticked yet: status says running, but the
            // clock is past end_time by a second.
            query
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] })  // testcase exists (DB-06)
                .mockResolvedValueOnce({
                    rows: [contestRow(new Date(Date.now() - 7200_000), new Date(Date.now() - 1000))],
                });

            await expect(validateAndQueueSubmission(payload, 5)).rejects.toMatchObject({
                statusCode: 400,
                message: 'The contest has ended.',
            });
        });

        it('rejects a submission before start_time (start_time-ε)', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] })  // testcase exists (DB-06)
                .mockResolvedValueOnce({
                    rows: [contestRow(new Date(Date.now() + 1000), new Date(Date.now() + 7200_000))],
                });

            await expect(validateAndQueueSubmission(payload, 5)).rejects.toMatchObject({
                statusCode: 400,
                message: 'The contest has not started yet.',
            });
        });
    });
});
