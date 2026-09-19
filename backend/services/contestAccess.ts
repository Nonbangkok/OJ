import * as db from '../db';
import { ContestRow, ContestStatus } from '../types/models';
import { ExistsRow } from '../types/service';

/**
 * Shared contest access helpers.
 *
 * Single home for the `contests` row / status lookup and the
 * contest-participant membership check that used to be copy-pasted across
 * contestQueryService, contestParticipantQueryService, and
 * submissionQueryService.
 */

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

/** True when the user is registered as a participant of the contest. */
export const isContestParticipant = async (contestId: string, userId: number): Promise<boolean> => {
    const result = await db.query<ExistsRow>(
        'SELECT 1 AS exists FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [contestId, userId],
    );
    return result.rows.length > 0;
};
