import * as db from '../../db';
import {
    getContestById,
    getContestStatusById,
    getVisibleContestById,
    getVisibleContestStatusById,
    isContestManagementRole,
} from '../../services/contestAccess';
import { updateContestVisibility } from '../../services/contestQueryService';

/**
 * Contest visibility gating at the shared-helper level.
 *
 * getContestById/getContestStatusById are the INTERNAL lookups (judge,
 * rejudge, scheduler, migration) and must never filter on visibility;
 * the getVisible* variants are the end-user gate.
 */

jest.mock('../../db');

const query = db.query as jest.Mock;

const hiddenRow = {
    id: 3, title: 'Hidden', description: null,
    start_time: new Date(), end_time: new Date(),
    status: 'running', created_at: new Date(), created_by: 1,
    is_visible: false,
};

describe('contestAccess visibility helpers', () => {
    beforeEach(() => {
        query.mockReset();
    });

    describe('getContestById (internal — never filtered)', () => {
        it('returns hidden contests unchanged for internal callers', async () => {
            query.mockResolvedValueOnce({ rows: [hiddenRow] });

            const contest = await getContestById('3');

            expect(contest).toEqual(hiddenRow);
            const [sql] = query.mock.calls[0];
            expect(String(sql)).not.toContain('is_visible');
        });
    });

    describe('getContestStatusById (internal — never filtered)', () => {
        it('returns the status of a hidden contest for internal callers', async () => {
            query.mockResolvedValueOnce({ rows: [{ status: 'running' }] });

            const status = await getContestStatusById('3');

            expect(status).toBe('running');
            const [sql] = query.mock.calls[0];
            expect(String(sql)).not.toContain('is_visible');
        });
    });

    describe('getVisibleContestById (end-user gate)', () => {
        it('reads a hidden contest as null for a normal user', async () => {
            query.mockResolvedValueOnce({ rows: [hiddenRow] });

            expect(await getVisibleContestById('3', { id: 5, role: 'user' })).toBeNull();
        });

        it('reads a hidden contest as null for a guest', async () => {
            query.mockResolvedValueOnce({ rows: [hiddenRow] });

            expect(await getVisibleContestById('3', undefined)).toBeNull();
        });

        it('returns the hidden contest for staff and admin', async () => {
            query.mockResolvedValue({ rows: [hiddenRow] });

            expect(await getVisibleContestById('3', { id: 1, role: 'staff' })).toEqual(hiddenRow);
            expect(await getVisibleContestById('3', { id: 1, role: 'admin' })).toEqual(hiddenRow);
        });

        it('returns visible contests for everyone', async () => {
            query.mockResolvedValue({ rows: [{ ...hiddenRow, is_visible: true }] });

            expect(await getVisibleContestById('3', { id: 5, role: 'user' })).toMatchObject({ is_visible: true });
            expect(await getVisibleContestById('3', undefined)).toMatchObject({ is_visible: true });
        });

        it('reads a nonexistent contest as null regardless of role', async () => {
            query.mockResolvedValue({ rows: [] });

            expect(await getVisibleContestById('999', { id: 1, role: 'admin' })).toBeNull();
        });
    });

    describe('getVisibleContestStatusById (end-user gate)', () => {
        it('reads a hidden contest as null for a normal user and guest', async () => {
            query.mockResolvedValue({ rows: [{ status: 'running', is_visible: false }] });

            expect(await getVisibleContestStatusById('3', { id: 5, role: 'user' })).toBeNull();
            expect(await getVisibleContestStatusById('3', undefined)).toBeNull();
        });

        it('returns the status of a hidden contest for staff', async () => {
            query.mockResolvedValueOnce({ rows: [{ status: 'running', is_visible: false }] });

            expect(await getVisibleContestStatusById('3', { id: 1, role: 'staff' })).toBe('running');
        });
    });

    describe('isContestManagementRole', () => {
        it('accepts staff and admin only', () => {
            expect(isContestManagementRole({ role: 'admin' })).toBe(true);
            expect(isContestManagementRole({ role: 'staff' })).toBe(true);
            expect(isContestManagementRole({ role: 'user' })).toBe(false);
            expect(isContestManagementRole(undefined)).toBe(false);
            expect(isContestManagementRole({})).toBe(false);
        });
    });
});

describe('updateContestVisibility (atomic focused update)', () => {
    beforeEach(() => {
        query.mockReset();
    });

    it('updates only the is_visible column and returns the updated row', async () => {
        query.mockResolvedValueOnce({ rows: [{ id: 3, title: 'Hidden', is_visible: false }] });

        const result = await updateContestVisibility('3', false);

        expect(result).toEqual({ id: 3, title: 'Hidden', is_visible: false });
        const [sql, params] = query.mock.calls[0];
        expect(String(sql)).toBe('UPDATE contests SET is_visible = $1 WHERE id = $2 RETURNING id, title, is_visible');
        expect(params).toEqual([false, '3']);
        // Single statement — no read-rewrite of the rest of the row.
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('returns null for a missing contest (no row rewritten)', async () => {
        query.mockResolvedValueOnce({ rows: [] });

        expect(await updateContestVisibility('999', true)).toBeNull();
        expect(query).toHaveBeenCalledTimes(1);
    });
});
