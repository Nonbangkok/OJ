import cron, { ScheduledTask } from 'node-cron';
import * as db from '../db';
import { migrateSubmissionsAfterContest } from './problemMigration';
import { CONTEST_STATUS } from '../constants';
import { ContestSchedulerStatus, ContestTimingRow } from '../types/service';
import { logger } from '../utils/logger';

/**
 * node-cron 4 reports missed ticks and task failures through its own
 * ANSI-coloured console logger. Route them through the structured logger:
 * per task via the `logger` option, and globally (shutdown errors etc.) via
 * setLogger in start().
 */
export const cronLogger = {
  info: (message: string): void => logger.info(message),
  warn: (message: string): void => logger.warn(message),
  error: (message: string | Error, err?: Error): void => {
    const cause = message instanceof Error ? message : err;
    logger.error(message instanceof Error ? 'contest scheduler task failed' : message, cause ? { err: cause } : undefined);
  },
  debug: (message: string | Error): void => logger.debug(message instanceof Error ? message.message : message),
};

/** XSYS-006: how many consecutive ticks a failing migration is retried before giving up. */
const MIGRATION_MAX_RETRIES = 5;

/**
 * A5-02: how many ticks a migration may be deferred because the contest's
 * judges have not drained yet (about half an hour at one tick a minute). A
 * judge backlog is not a failure, so deferrals never use up
 * MIGRATION_MAX_RETRIES. Once this budget is spent the contest finishes
 * anyway and its unjudged submissions are re-judged in the practice pool.
 */
const MIGRATION_MAX_DRAIN_DEFERRALS = 30;

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
  // A5-02: consecutive ticks whose migration was deferred because the
  // contest's judges were still in flight (see MIGRATION_MAX_DRAIN_DEFERRALS).
  private drainDeferrals: Map<number, number>;

  constructor() {
    this.isRunning = false;
    this.checkInterval = null;
    this.tickInProgress = false;
    this.paused = false;
    this.migrationFailures = new Map();
    this.drainDeferrals = new Map();
  }

  // Start the scheduler
  start(): void {
    if (this.isRunning) {
      logger.warn('contest scheduler is already running');
      return;
    }

    logger.info('starting contest scheduler');

    // node-cron's global logger (used outside any task, e.g. shutdown()).
    cron.setLogger(cronLogger);

    // Check every minute for contests that need to start or end
    this.checkInterval = cron.schedule('* * * * *', async () => {
      try {
        await this.checkContestStatus();
      } catch (error) {
        logger.error('contest scheduler start failed', { err: error });
      }
    }, {
      timezone: 'Asia/Bangkok',
      logger: cronLogger,
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
          // A previous tick's migration failed or was deferred; this tick is the retry.
          const failures = this.migrationFailures.get(contest.id) ?? 0;
          if (failures >= MIGRATION_MAX_RETRIES) {
            logger.debug('contest migration retries exhausted - skipping tick', { contestId: contest.id });
            continue;
          }
          const deferrals = this.drainDeferrals.get(contest.id) ?? 0;
          if (failures === 0 && deferrals > 0) {
            logger.info('retrying deferred contest migration', { contestId: contest.id, deferrals });
          } else {
            logger.warn('retrying failed contest migration', { contestId: contest.id, attempt: failures + 1 });
          }
        }

        // Migrate submissions and finalize contest (this may take time)
        try {
          logger.info('migrating submissions after contest', { contestId: contest.id });
          const deferrals = this.drainDeferrals.get(contest.id) ?? 0;
          const proceedWithJudgesInFlight = deferrals >= MIGRATION_MAX_DRAIN_DEFERRALS;
          if (proceedWithJudgesInFlight) {
            logger.error('contest judges did not drain within the deferral budget - finishing anyway, unjudged submissions are re-judged after the move', {
              contestId: contest.id,
              deferrals,
            });
          }
          const result = await migrateSubmissionsAfterContest(contest.id, { proceedWithJudgesInFlight });
          if (result?.deferred) {
            // Judges still in flight: nothing was written, the contest stays
            // 'finishing' and the next tick tries again.
            this.drainDeferrals.set(contest.id, deferrals + 1);
            logger.warn('contest migration deferred - judges still in flight, will retry on next tick', {
              contestId: contest.id,
              deferral: deferrals + 1,
              maxDeferrals: MIGRATION_MAX_DRAIN_DEFERRALS,
            });
            continue;
          }
          this.migrationFailures.delete(contest.id);
          this.drainDeferrals.delete(contest.id);
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
