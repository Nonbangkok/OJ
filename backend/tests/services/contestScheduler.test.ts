import contestScheduler from '../../services/contestScheduler';
import * as db from '../../db';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import cron from 'node-cron';

jest.mock('../../db');
jest.mock('../../services/problemMigration');
jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ stop: jest.fn() }))
}));

describe('Contest Scheduler Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.log = jest.fn();
        console.error = jest.fn();
        (contestScheduler as any).isRunning = false;
        (contestScheduler as any).checkInterval = null;
    });

    describe('start / stop', () => {
        it('should start the scheduler and register a cron job', () => {
            contestScheduler.start();
            expect(contestScheduler.getStatus().isRunning).toBe(true);
            expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function), expect.any(Object));
        });

        it('should not start multiple instances', () => {
            contestScheduler.start();
            contestScheduler.start();
            expect(cron.schedule).toHaveBeenCalledTimes(1);
        });

        it('should stop the scheduler', () => {
            contestScheduler.start();
            const mockStop = (contestScheduler as any).checkInterval.stop;

            contestScheduler.stop();

            expect(contestScheduler.getStatus().isRunning).toBe(false);
            expect(mockStop).toHaveBeenCalled();
        });
    });

    describe('checkContestStatus', () => {
        it('should start scheduled contests that have reached start_time', async () => {
            const mockNow = new Date('2025-01-01T12:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Contest 1' }] }) // start scheduled
                .mockResolvedValueOnce({}) // UPDATE to running
                .mockResolvedValueOnce({ rows: [] }); // end running (none)

            await contestScheduler.checkContestStatus();

            expect(db.query).toHaveBeenNthCalledWith(1, expect.stringContaining('SELECT id, title, start_time'), [mockNow]);
            expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE contests \n          SET status = \'running\''), [1]);

            jest.useRealTimers();
        });

        it('should end running contests, trigger migration, and mark finishing', async () => {
            const mockNow = new Date('2025-01-01T15:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                .mockResolvedValueOnce({ rows: [{ id: 2, title: 'Contest 2' }] }) // end running
                .mockResolvedValueOnce({}); // UPDATE to finishing

            (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValueOnce({});

            await contestScheduler.checkContestStatus();

            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE contests \n          SET status = \'finishing\''), [2]);
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(2);

            jest.useRealTimers();
        });

        it('should still mark contest as finished if migration fails', async () => {
            const mockNow = new Date('2025-01-01T15:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ id: 3, title: 'Contest 3' }] })
                .mockResolvedValueOnce({}) // finishing
                .mockResolvedValueOnce({}); // fallback to finished

            const error = new Error('Migration failed');
            (migrateSubmissionsAfterContest as jest.Mock).mockRejectedValueOnce(error);

            await contestScheduler.checkContestStatus();

            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error migrating'), error);
            expect(db.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE contests \n            SET status = \'finished\''), [3]);

            jest.useRealTimers();
        });
    });
});
