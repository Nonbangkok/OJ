import cron, { ScheduledTask } from 'node-cron';
import * as db from '../db';
import { migrateSubmissionsAfterContest } from './problemMigration';
import { CONTEST_STATUS } from '../constants';
import { ContestSchedulerStatus, ContestTimingRow } from '../types/service';
import { logger } from '../utils/logger';

class ContestScheduler {
  private isRunning: boolean;
  private checkInterval: ScheduledTask | null;
  // Guards the tick body itself: a slow migration must not let an overlapping
  // per-minute tick double-process the same contest. `isRunning` only guards
  // start(), not the tick.
  private tickInProgress: boolean;

  constructor() {
    this.isRunning = false;
    this.checkInterval = null;
    this.tickInProgress = false;
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

  // End contests that should be finished now
  async endRunningContests(now: Date): Promise<void> {
    try {
      const result = await db.query<ContestTimingRow>(`
        SELECT id, title, end_time 
        FROM contests 
        WHERE status = '${CONTEST_STATUS.RUNNING}'
        AND end_time <= $1
        ORDER BY end_time ASC
      `, [now]);

      for (const contest of result.rows) {
        logger.info('ending contest', { contestId: contest.id, title: contest.title });

        // Set status to 'finishing' to prevent new submissions
        await db.query(`
          UPDATE contests
          SET status = '${CONTEST_STATUS.FINISHING}'
          WHERE id = $1
        `, [contest.id]);

        logger.info('contest status updated', { contestId: contest.id, status: CONTEST_STATUS.FINISHING });

        // Migrate submissions and finalize contest (this may take time)
        try {
          logger.info('migrating submissions after contest', { contestId: contest.id });
          await migrateSubmissionsAfterContest(contest.id);
          logger.info('contest migration completed', { contestId: contest.id });
        } catch (migrationError) {
          logger.error('contest migration failed', { contestId: contest.id, err: migrationError });

          // Even if migration fails, update status to prevent infinite loops
          await db.query(`
            UPDATE contests
            SET status = '${CONTEST_STATUS.FINISHED}'
            WHERE id = $1
          `, [contest.id]);

          logger.warn('contest marked finished despite migration error', { contestId: contest.id });
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
