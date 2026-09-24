import 'dotenv/config';
import { pool } from '../db';
import { backfillSolveRewards } from '../services/progressionService';

/**
 * Backfills user_problem_rewards from historical submissions.
 *
 * Awards one reward per unique (user, problem) whose submissions contain an
 * Accepted verdict in either the standalone pool or contest_submissions.
 * Each new reward snapshots the problem's current difficulty and uses the
 * user's FIRST Accepted timestamp as awarded_at.
 *
 * Idempotent: rerunning only adds pairs first solved since the previous run;
 * existing rewards (and their snapshots) are never modified.
 *
 * Run from the backend directory:
 *   npm run build && node dist/scripts/backfill_xp.js
 * or via tsx without building:
 *   npx tsx scripts/backfill_xp.ts
 */
const main = async (): Promise<void> => {
    try {
        const inserted = await backfillSolveRewards();
        console.log(`Backfill complete: ${inserted} new reward record(s) created.`);
    } catch (err) {
        console.error('XP backfill failed:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

void main();
