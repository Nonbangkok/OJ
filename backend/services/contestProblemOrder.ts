import { PoolClient } from 'pg';
import * as db from '../db';
import { CONTEST_STATUS } from '../constants';

/**
 * ORDER BY for a contest's problem list (B4): the admin's order, then id.
 * `contest_position` lives on `problems` (scheduled/running contests);
 * `position` on the `contest_problems` snapshot (finished contests).
 */
export const contestProblemOrderSql = (alias: string, positionColumn: 'contest_position' | 'position'): string => {
    const idColumn = positionColumn === 'contest_position' ? 'id' : 'problem_id';
    return `${alias}.${positionColumn} NULLS LAST, ${alias}.${idColumn}`;
};

export type ReorderContestProblemsResult =
    | { kind: 'ok' }
    | { kind: 'not_found' }
    | { kind: 'invalid_status' }
    | { kind: 'mismatch' };

/** Rewrites a scheduled/running contest's problem order to 1..n in the given order. */
export const reorderContestProblems = async (
    contestId: string,
    problemIds: string[],
): Promise<ReorderContestProblemsResult> => {
    const client: PoolClient = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const contest = await client.query<{ status: string }>(
            'SELECT status FROM contests WHERE id = $1 FOR UPDATE',
            [contestId],
        );
        if (contest.rows.length === 0) {
            await client.query('ROLLBACK');
            return { kind: 'not_found' };
        }
        const status = contest.rows[0].status;
        if (status !== CONTEST_STATUS.SCHEDULED && status !== CONTEST_STATUS.RUNNING) {
            await client.query('ROLLBACK');
            return { kind: 'invalid_status' };
        }
        const current = await client.query<{ id: string }>('SELECT id FROM problems WHERE contest_id = $1', [contestId]);
        const currentIds = new Set(current.rows.map((r) => r.id));
        if (currentIds.size !== problemIds.length || !problemIds.every((id) => currentIds.has(id))) {
            await client.query('ROLLBACK');
            return { kind: 'mismatch' };
        }
        await client.query(
            `UPDATE problems p
             SET contest_position = o.ord
             FROM unnest($2::text[]) WITH ORDINALITY AS o(id, ord)
             WHERE p.id = o.id AND p.contest_id = $1`,
            [contestId, problemIds],
        );
        await client.query('COMMIT');
        return { kind: 'ok' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
