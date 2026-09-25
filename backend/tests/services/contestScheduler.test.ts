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
        (contestScheduler as any).migrationFailures = new Map();
        // Default: no contests to process (individual tests override with
        // mockResolvedValueOnce chains).
        (db.query as jest.Mock).mockResolvedValue({ rows: [] });
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
            expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE contests\n          SET status = \'running\''), [1]);

            jest.useRealTimers();
        });

        it('should end running contests, trigger migration, and mark finishing', async () => {
            const mockNow = new Date('2025-01-01T15:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                .mockResolvedValueOnce({ rows: [{ id: 2, title: 'Contest 2', status: 'running' }] }) // end running
                .mockResolvedValueOnce({}); // UPDATE to finishing

            (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValueOnce({});

            await contestScheduler.checkContestStatus();

            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringMatching(/UPDATE contests\s+SET status = 'finishing'/), [2]);
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(2);

            jest.useRealTimers();
        });

        it('keeps a failed migration in finishing and retries it on the next tick (XSYS-006/CONTEST-004)', async () => {
            const mockNow = new Date('2025-01-01T15:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            // Tick 1: running contest whose migration fails.
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                .mockResolvedValueOnce({ rows: [{ id: 3, title: 'Contest 3', status: 'running' }] })
                .mockResolvedValueOnce({}); // UPDATE to finishing

            (migrateSubmissionsAfterContest as jest.Mock).mockRejectedValueOnce(new Error('Migration failed'));

            await contestScheduler.checkContestStatus();

            // The contest is NEVER flipped to finished on failure — that is
            // the bug this fixes. Only three queries ran.
            expect(db.query).toHaveBeenCalledTimes(3);
            const allSql = (db.query as jest.Mock).mock.calls.map((c) => String(c[0]));
            expect(allSql.some((sql) => sql.includes("'finished'"))).toBe(false);
            // The dev-mode logger flattens message + fields into one line.
            expect(console.error).toHaveBeenCalledWith(
                expect.stringMatching(
                    /contest migration failed - will retry on next tick .*contestId=3 .*attempt=1 /
                ),
            );

            // Tick 2: the contest comes back as 'finishing' and the
            // migration is retried, this time successfully.
            (db.query as jest.Mock).mockClear();
            (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // start scheduled (none)
            (migrateSubmissionsAfterContest as jest.Mock).mockClear();
            (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValueOnce({});

            // Re-select returns the same contest, now finishing.
            (db.query as jest.Mock).mockReset();
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                .mockResolvedValueOnce({ rows: [{ id: 3, title: 'Contest 3', status: 'finishing' }] });

            await contestScheduler.checkContestStatus();

            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(3);
            // A finishing contest is not re-flipped to finishing.
            const updateCalls = (db.query as jest.Mock).mock.calls
                .map((c) => String(c[0]))
                .filter((sql) => sql.includes('UPDATE contests'));
            expect(updateCalls).toHaveLength(0);

            jest.useRealTimers();
        });

        it('stops auto-retrying after the retry budget is exhausted and leaves the contest in finishing', async () => {
            const mockNow = new Date('2025-01-01T15:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            for (let attempt = 1; attempt <= 5; attempt += 1) {
                (db.query as jest.Mock).mockReset();
                (db.query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                    .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Contest 4', status: attempt === 1 ? 'running' : 'finishing' }] })
                    .mockResolvedValueOnce({}); // UPDATE to finishing (first tick only)
                (migrateSubmissionsAfterContest as jest.Mock).mockReset();
                (migrateSubmissionsAfterContest as jest.Mock).mockRejectedValueOnce(new Error('Migration failed'));

                await contestScheduler.checkContestStatus();
            }

            // The 5th failure logged the permanent ERROR, still without
            // flipping the contest to finished.
            expect(console.error).toHaveBeenCalledWith(
                expect.stringMatching(
                    /contest migration failed permanently - contest left in finishing status.*contestId=4 .*attempts=5 /
                ),
            );

            // Tick 6: exhausted — the migration is not attempted again.
            (db.query as jest.Mock).mockReset();
            (migrateSubmissionsAfterContest as jest.Mock).mockClear();
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Contest 4', status: 'finishing' }] });

            await contestScheduler.checkContestStatus();

            expect(migrateSubmissionsAfterContest).not.toHaveBeenCalled();
            const allSql = (db.query as jest.Mock).mock.calls.map((c) => String(c[0]));
            expect(allSql.some((sql) => sql.includes("'finished'"))).toBe(false);

            jest.useRealTimers();
        });

        it('should skip a tick while a previous tick is still in progress', async () => {
            const mockNow = new Date('2025-01-01T12:00:00Z');
            jest.useFakeTimers().setSystemTime(mockNow);

            // First tick: hold the migration "in flight" until we release it.
            let releaseFirstTick!: () => void;
            const firstTickGate = new Promise<void>((resolve) => { releaseFirstTick = resolve; });
            (migrateSubmissionsAfterContest as jest.Mock).mockImplementationOnce(() => firstTickGate);
            (db.query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                .mockResolvedValueOnce({ rows: [{ id: 7, title: 'Slow Contest', status: 'running' }] }) // end running
                .mockResolvedValueOnce({}); // UPDATE to finishing

            const firstTick = contestScheduler.checkContestStatus();

            // Drain the microtask queue so the first tick runs up to the
            // gated migration call (fake timers make setImmediate unusable).
            for (let i = 0; i < 20 && (migrateSubmissionsAfterContest as jest.Mock).mock.calls.length === 0; i++) {
                await Promise.resolve();
            }
            expect((migrateSubmissionsAfterContest as jest.Mock).mock.calls.length).toBe(1);

            // Overlapping tick while the first is still migrating: must be skipped.
            await contestScheduler.checkContestStatus();
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('tick already in progress'));
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledTimes(1);

            // Release the first tick; it completes its normal three queries
            // (start-check, end-check, finishing update) — no extra queries
            // may have been added by the skipped tick.
            releaseFirstTick();
            await firstTick;
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(7);
            expect(db.query).toHaveBeenCalledTimes(3);

            jest.useRealTimers();
        });
    });
});
