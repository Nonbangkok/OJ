export = contestScheduler;
declare const contestScheduler: ContestScheduler;
declare class ContestScheduler {
    isRunning: boolean;
    checkInterval: cron.ScheduledTask | null;
    start(): void;
    stop(): void;
    checkContestStatus(): Promise<void>;
    startScheduledContests(now: any): Promise<void>;
    endRunningContests(now: any): Promise<void>;
    getStatus(): {
        isRunning: boolean;
        lastCheck: string;
        schedulerActive: boolean;
    };
    manualCheck(): Promise<void>;
}
import cron = require("node-cron");
