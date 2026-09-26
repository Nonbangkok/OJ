import * as db from '../db';
import { ContestRow, ContestStatus } from '../types/models';
import { ExistsRow } from '../types/service';
import { USER_ROLES } from '../constants';

/**
 * Shared contest access helpers.
 *
 * Single home for the `contests` row / status lookup and the
 * contest-participant membership check that used to be copy-pasted across
 * contestQueryService, contestParticipantQueryService, and
 * submissionQueryService.
 */

/** Viewer context for visibility gating. */
export interface ContestViewer {
    id?: number;
    role?: string;
}

/** True when the viewer's role bypasses the end-user visibility gate. */
export const isContestManagementRole = (viewer?: ContestViewer): boolean =>
    viewer?.role === USER_ROLES.ADMIN || viewer?.role === USER_ROLES.STAFF;

/**
 * Fetch a contest row applying the end-user visibility gate.
 *
 * Hidden contests read as nonexistent (null) for normal users and guests —
 * the same non-enumeration convention as hidden problems (PROBLEM-002).
 * Staff/admin get the row regardless of visibility; internal callers
 * (judge, scheduler, migration) keep using getContestById, which never
 * filters.
 */
export const getVisibleContestById = async (
    contestId: string,
    viewer?: ContestViewer,
): Promise<ContestRow | null> => {
    const contest = await getContestById(contestId);
    if (!contest) {
        return null;
    }
    if (!contest.is_visible && !isContestManagementRole(viewer)) {
        return null;
    }
    return contest;
};

/** Fetch a full contest row, or null when the contest does not exist. */
export const getContestById = async (contestId: string): Promise<ContestRow | null> => {
    const result = await db.query<ContestRow>('SELECT * FROM contests WHERE id = $1', [contestId]);
    return result.rows[0] ?? null;
};

/** Fetch only a contest's status, or null when the contest does not exist. */
export const getContestStatusById = async (contestId: string): Promise<ContestStatus | null> => {
    const result = await db.query<Pick<ContestRow, 'status'>>('SELECT status FROM contests WHERE id = $1', [contestId]);
    return result.rows[0]?.status ?? null;
};

/**
 * Status lookup with the end-user visibility gate applied: hidden contests
 * read as nonexistent for normal users/guests, staff/admin see through it.
 */
export const getVisibleContestStatusById = async (
    contestId: string,
    viewer?: ContestViewer,
): Promise<ContestStatus | null> => {
    const result = await db.query<Pick<ContestRow, 'status' | 'is_visible'>>(
        'SELECT status, is_visible FROM contests WHERE id = $1',
        [contestId],
    );
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    if (!row.is_visible && !isContestManagementRole(viewer)) {
        return null;
    }
    return row.status;
};

/** True when the user is registered as a participant of the contest. */
export const isContestParticipant = async (contestId: string, userId: number): Promise<boolean> => {
    const result = await db.query<ExistsRow>(
        'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [contestId, userId],
    );
    return result.rows.length > 0;
};
