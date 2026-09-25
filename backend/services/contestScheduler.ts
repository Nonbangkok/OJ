import cron, { ScheduledTask } from 'node-cron';
import * as db from '../db';
import { migrateSubmissionsAfterContest } from './problemMigration';
import { CONTEST_STATUS } from '../constants';
import { ContestSchedulerStatus, ContestTimingRow } from '../types/service';
import { logger } from '../utils/logger';

/** XSYS-006: how many consecutive ticks a failing migration is retried before giving up. */
const MIGRATION_MAX_RETRIES = 5;

class ContestScheduler {
  private isRunning: boolean;
  private checkInterval: ScheduledTask | null;
  // Guards the tick body itself: a slow migration must not let an overlapping
  // per-minute tick double-process the same contest. `isRunning` only guards
  // start(), not the tick.
  private tickInProgress: boolean;
  // DB-05: while a database import runs, the schema is being dropped and
  // recreated — ticks would only produce errors. Pausing keeps the cron task
  // registered; ticks are skipped until resume().
  private paused: boolean;
  // XSYS-006/CONTEST-004: consecutive migration failures per contest. A
  // failing migration keeps the contest in 'finishing' and is retried on
  // later ticks until MIGRATION_MAX_RETRIES is exhausted (then it stops
  // auto-retrying and needs manual intervention).
  private migrationFailures: Map<number, number>;

  constructor() {
    this.isRunning = false;
    this.checkInterval = null;
    this.tickInProgress = false;
    this.paused = false;
    this.migrationFailures = new Map();
  }

  // Start the scheduler
  start(): void {
    if (this.isRunning) {
      logger.warn('contest scheduler is already running');
      return;
    }

    logger.info('starting contest scheduler');

    // Check every minute for contests that need to start or end
    this.checkInterval = cron.schedule('* * * * *', async () => {
      try {
        await this.checkContestStatus();
      } catch (error) {
        logger.error('contest scheduler start failed', { err: error });
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Bangkok'
    });

    this.isRunning = true;
    logger.info('contest scheduler started - checking every minute');
  }

  /** DB-05: skip ticks while a database import holds the schema hostage. */
  pause(): void {
    this.paused = true;
    logger.warn('contest scheduler paused (database maintenance)');
  }

  resume(): void {
    this.paused = false;
    logger.info('contest scheduler resumed');
  }

  // Stop the scheduler
  stop(): void {
    if (this.checkInterval) {
      this.checkInterval.stop();
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info('contest scheduler stopped');
  }

  // Main function to check and update contest statuses
  async checkContestStatus(): Promise<void> {
    if (this.tickInProgress) {
      logger.debug('contest scheduler tick already in progress - skipping');
      return;
    }
    if (this.paused) {
      logger.debug('contest scheduler paused - skipping tick');
      return;
    }

    const now = new Date();
    this.tickInProgress = true;

    try {
      // 1. Start scheduled contests
      await this.startScheduledContests(now);

      // 2. End running contests
      await this.endRunningContests(now);

    } catch (error) {
      logger.error('contest status check failed', { err: error });
      throw error;
    } finally {
      this.tickInProgress = false;
    }
  }

  // Start contests that should be running now
  async startScheduledContests(now: Date): Promise<void> {
    try {
      const result = await db.query<ContestTimingRow>(`
        SELECT id, title, start_time 
        FROM contests 
        WHERE status = '${CONTEST_STATUS.SCHEDULED}'
        AND start_time <= $1
        ORDER BY start_time ASC
      `, [now]);

      for (const contest of result.rows) {
        logger.info('starting contest', { contestId: contest.id, title: contest.title });

        await db.query(`
          UPDATE contests
          SET status = '${CONTEST_STATUS.RUNNING}'
          WHERE id = $1
        `, [contest.id]);

        logger.info('contest status updated', { contestId: contest.id, status: CONTEST_STATUS.RUNNING });
      }

      if (result.rows.length > 0) {
        logger.info('started scheduled contests', { count: result.rows.length });
      }
    } catch (error) {
      logger.error('failed to start scheduled contests', { err: error });
      throw error;
    }
  }

  // End contests that should be finished now, and retry migrations for
  // contests still stuck in 'finishing' (XSYS-006/CONTEST-004: a failed
  // migration must NOT mark the contest finished — that stranded the whole
  // contest's data with no retry path, since migrate requires 'finishing').
  async endRunningContests(now: Date): Promise<void> {
    try {
      const result = await db.query<ContestTimingRow & { status: string }>(`
        SELECT id, title, status, end_time
        FROM contests
        WHERE (status = '${CONTEST_STATUS.RUNNING}' AND end_time <= $1)
           OR status = '${CONTEST_STATUS.FINISHING}'
        ORDER BY end_time ASC
      `, [now]);

      for (const contest of result.rows) {
        if (contest.status === CONTEST_STATUS.RUNNING) {
          logger.info('ending contest', { contestId: contest.id, title: contest.title });

          // Set status to 'finishing' to prevent new submissions
          await db.query(`
            UPDATE contests
            SET status = '${CONTEST_STATUS.FINISHING}'
            WHERE id = $1
          `, [contest.id]);

          logger.info('contest status updated', { contestId: contest.id, status: CONTEST_STATUS.FINISHING });
        } else {
          // A previous tick's migration failed; this tick is the retry.
          const failures = this.migrationFailures.get(contest.id) ?? 0;
          if (failures >= MIGRATION_MAX_RETRIES) {
            logger.debug('contest migration retries exhausted - skipping tick', { contestId: contest.id });
            continue;
          }
          logger.warn('retrying failed contest migration', { contestId: contest.id, attempt: failures + 1 });
        }

        // Migrate submissions and finalize contest (this may take time)
        try {
          logger.info('migrating submissions after contest', { contestId: contest.id });
          await migrateSubmissionsAfterContest(contest.id);
          this.migrationFailures.delete(contest.id);
          logger.info('contest migration completed', { contestId: contest.id });
        } catch (migrationError) {
          const failures = (this.migrationFailures.get(contest.id) ?? 0) + 1;
          this.migrationFailures.set(contest.id, failures);

          if (failures >= MIGRATION_MAX_RETRIES) {
            // The contest STAYS in 'finishing' — the only status from which
            // migration can (re)run — so recovery remains possible after the
            // underlying problem is fixed. This needs manual attention.
            logger.error(
              'contest migration failed permanently - contest left in finishing status, manual intervention required',
              { contestId: contest.id, attempts: failures, err: migrationError },
            );
          } else {
            logger.error('contest migration failed - will retry on next tick', {
              contestId: contest.id,
              attempt: failures,
              maxRetries: MIGRATION_MAX_RETRIES,
              err: migrationError,
            });
          }
        }
      }

      if (result.rows.length > 0) {
        logger.info('ended running contests', { count: result.rows.length });
      }
    } catch (error) {
      logger.error('failed to end running contests', { err: error });
      throw error;
    }
  }

  // Get scheduler status
  getStatus(): ContestSchedulerStatus {
    return {
      isRunning: this.isRunning,
      lastCheck: new Date().toISOString(),
      schedulerActive: this.checkInterval ? true : false
    };
  }

  // Manual trigger for testing
  async manualCheck(): Promise<void> {
    logger.info('manual contest status check triggered');
    await this.checkContestStatus();
  }
}

// Create a singleton instance
const contestScheduler = new ContestScheduler();

export default contestScheduler;
