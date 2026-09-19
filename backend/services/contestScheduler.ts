import cron, { ScheduledTask } from 'node-cron';
import * as db from '../db';
import { migrateSubmissionsAfterContest } from './problemMigration';
import { CONTEST_STATUS } from '../constants';
import { ContestSchedulerStatus, ContestTimingRow } from '../types/service';

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
      console.log('Contest scheduler is already running');
      return;
    }

    console.log('Starting Contest Scheduler...');

    // Check every minute for contests that need to start or end
    this.checkInterval = cron.schedule('* * * * *', async () => {
      try {
        await this.checkContestStatus();
      } catch (error) {
        console.error('Error in contest scheduler:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Bangkok'
    });

    this.isRunning = true;
    console.log('Contest Scheduler started - checking every minute');
  }

  // Stop the scheduler
  stop(): void {
    if (this.checkInterval) {
      this.checkInterval.stop();
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Contest Scheduler stopped');
  }

  // Main function to check and update contest statuses
  async checkContestStatus(): Promise<void> {
    if (this.tickInProgress) {
      console.log('Contest scheduler tick already in progress - skipping this tick');
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
      console.error('Error checking contest status:', error);
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
        console.log(`🚀 Starting contest: ${contest.title} (ID: ${contest.id})`);

        await db.query(`
          UPDATE contests
          SET status = '${CONTEST_STATUS.RUNNING}'
          WHERE id = $1
        `, [contest.id]);

        console.log(`✅ Contest ${contest.id} status updated to 'running'`);
      }

      if (result.rows.length > 0) {
        console.log(`Started ${result.rows.length} contest(s)`);
      }
    } catch (error) {
      console.error('Error starting scheduled contests:', error);
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
        console.log(`🏁 Ending contest: ${contest.title} (ID: ${contest.id})`);

        // Set status to 'finishing' to prevent new submissions
        await db.query(`
          UPDATE contests
          SET status = '${CONTEST_STATUS.FINISHING}'
          WHERE id = $1
        `, [contest.id]);

        console.log(`⏳ Contest ${contest.id} status updated to 'finishing'`);

        // Migrate submissions and finalize contest (this may take time)
        try {
          console.log(`📊 Migrating submissions for contest ${contest.id}...`);
          await migrateSubmissionsAfterContest(contest.id);
          console.log(`✅ Contest ${contest.id} migration completed successfully`);
        } catch (migrationError) {
          console.error(`❌ Error migrating contest ${contest.id}:`, migrationError);

          // Even if migration fails, update status to prevent infinite loops
          await db.query(`
            UPDATE contests
            SET status = '${CONTEST_STATUS.FINISHED}'
            WHERE id = $1
          `, [contest.id]);

          console.log(`⚠️ Contest ${contest.id} marked as finished despite migration error`);
        }
      }

      if (result.rows.length > 0) {
        console.log(`Ended ${result.rows.length} contest(s)`);
      }
    } catch (error) {
      console.error('Error ending running contests:', error);
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
    console.log('Manual contest status check triggered');
    await this.checkContestStatus();
  }
}

// Create a singleton instance
const contestScheduler = new ContestScheduler();

export default contestScheduler;
