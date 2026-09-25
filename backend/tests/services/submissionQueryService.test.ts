import { getSubmissions, searchProblems } from '../../services/submissionQueryService';
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
    });

    describe('getSubmissions contest feed', () => {
        it('throws 403 for a non-participant of a running contest', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
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
                .mockResolvedValueOnce({ rows: [{ status: 'finished' }] })
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
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows }); // feed query (no participant check for staff)

            const result = await getSubmissions({ contestId: '3' }, 1, true);

            expect(result).toEqual(rows);
            expect(query).toHaveBeenCalledTimes(2);
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
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows: [] }); // participant check: no

            const result = await searchProblems('aplusb', { userId: 5, role: 'user' }, '1');

            expect(result).toEqual([]);
            expect(query).toHaveBeenCalledTimes(2);
        });

        it('returns contest problems to a participant of a running contest', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // participant check: yes
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] });

            const result = await searchProblems('aplusb', { userId: 5, role: 'user' }, '1');

            expect(result).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
        });

        it('skips the participant check for staff', async () => {
            query
                .mockResolvedValueOnce({ rows: [{ status: 'running' }] })
                .mockResolvedValueOnce({ rows: [{ id: 'aplusb', title: 'A Plus B' }] });

            const result = await searchProblems('aplusb', { userId: 1, role: 'admin' }, '1');

            expect(result).toEqual([{ id: 'aplusb', title: 'A Plus B' }]);
            expect(query).toHaveBeenCalledTimes(2);
        });
    });
});
