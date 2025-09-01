const cron = require('node-cron');
const db = require('../db');
const { migrateSubmissionsAfterContest } = require('./problemMigration');

class ContestScheduler {
  constructor() {
    this.isRunning = false;
    this.checkInterval = null;
  }

  // Start the scheduler
  start() {
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
  stop() {
    if (this.checkInterval) {
      this.checkInterval.stop();
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Contest Scheduler stopped');
  }

  // Main function to check and update contest statuses
  async checkContestStatus() {
    const now = new Date();
    
    try {
      // 1. Start scheduled contests
      await this.startScheduledContests(now);
      
      // 2. End running contests
      await this.endRunningContests(now);
      
    } catch (error) {
      console.error('Error checking contest status:', error);
      throw error;
    }
  }

  // Start contests that should be running now
  async startScheduledContests(now) {
    try {
      const result = await db.query(`
        SELECT id, title, start_time 
        FROM contests 
        WHERE status = 'scheduled' 
        AND start_time <= $1
        ORDER BY start_time ASC
      `, [now]);

      for (const contest of result.rows) {
        console.log(`🚀 Starting contest: ${contest.title} (ID: ${contest.id})`);
        
        await db.query(`
          UPDATE contests 
          SET status = 'running' 
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
  async endRunningContests(now) {
    try {
      const result = await db.query(`
        SELECT id, title, end_time 
        FROM contests 
        WHERE status = 'running' 
        AND end_time <= $1
        ORDER BY end_time ASC
      `, [now]);

      for (const contest of result.rows) {
        console.log(`🏁 Ending contest: ${contest.title} (ID: ${contest.id})`);
        
        // Set status to 'finishing' to prevent new submissions
        await db.query(`
          UPDATE contests 
          SET status = 'finishing' 
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
            SET status = 'finished' 
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
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCheck: new Date().toISOString(),
      schedulerActive: this.checkInterval ? true : false
    };
  }

  // Manual trigger for testing
  async manualCheck() {
    console.log('Manual contest status check triggered');
    await this.checkContestStatus();
  }
}

// Create a singleton instance
const contestScheduler = new ContestScheduler();

module.exports = contestScheduler; 