import contestScheduler, { cronLogger } from '../../services/contestScheduler';
import * as db from '../../db';
import { migrateSubmissionsAfterContest } from '../../services/problemMigration';
import cron from 'node-cron';
import { logger } from '../../utils/logger';
import { JUDGE_CONFIG } from '../../constants';

jest.mock('../../db');
jest.mock('../../services/problemMigration');
jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ stop: jest.fn() })),
    setLogger: jest.fn(),
}));

// The attempt on the tick a contest ends waits up to the full drain timeout;
// every later attempt (a retry of a deferred or failed migration) only briefly.
const FULL_DRAIN = JUDGE_CONFIG.CONTEST_MIGRATION_DRAIN_TIMEOUT_MS;
const RETRY_DRAIN = JUDGE_CONFIG.CONTEST_MIGRATION_RETRY_DRAIN_TIMEOUT_MS;

describe('Contest Scheduler Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.log = jest.fn();
        console.error = jest.fn();
        (contestScheduler as any).isRunning = false;
        (contestScheduler as any).checkInterval = null;
        (contestScheduler as any).migrationFailures = new Map();
        (contestScheduler as any).drainDeferrals = new Map();
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

        it('registers the per-minute job in Asia/Bangkok with the structured logger', () => {
            contestScheduler.start();
            expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function), {
                timezone: 'Asia/Bangkok',
                logger: cronLogger,
            });
        });

        it("routes node-cron's global logger through the structured logger", () => {
            contestScheduler.start();
            expect(cron.setLogger).toHaveBeenCalledTimes(1);
            expect(cron.setLogger).toHaveBeenCalledWith(cronLogger);
        });

        it('forwards node-cron log calls to the structured logger', () => {
            const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
            const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
            cronLogger.warn('missed execution at X!');
            expect(warn).toHaveBeenCalledWith('missed execution at X!');
            const boom = new Error('boom');
            cronLogger.error(boom);
            expect(error).toHaveBeenCalledWith('contest scheduler task failed', { err: boom });
            cronLogger.error('plain');
            expect(error).toHaveBeenCalledWith('plain', undefined);
            warn.mockRestore();
            error.mockRestore();
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
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(2, { proceedWithJudgesInFlight: false, drainTimeoutMs: FULL_DRAIN });

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

            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(3, { proceedWithJudgesInFlight: false, drainTimeoutMs: RETRY_DRAIN });
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
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(7, { proceedWithJudgesInFlight: false, drainTimeoutMs: FULL_DRAIN });
            expect(db.query).toHaveBeenCalledTimes(3);

            jest.useRealTimers();
        });

        describe('fairness: deferring contests never hold up other contests', () => {
            it('flips every due contest (scheduled -> running, running -> finishing) before any finish migration', async () => {
                jest.useFakeTimers().setSystemTime(new Date('2025-01-01T15:00:00Z'));
                (db.query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [{ id: 10, title: 'Starts now' }] }) // start scheduled
                    .mockResolvedValueOnce({}) // UPDATE 10 to running
                    .mockResolvedValueOnce({ rows: [
                        { id: 11, title: 'Deferred earlier', status: 'finishing' },
                        { id: 12, title: 'Ends now', status: 'running' },
                        { id: 13, title: 'Ends now too', status: 'running' },
                    ] })
                    .mockResolvedValue({}); // UPDATEs to finishing
                (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValue({ success: true });

                await contestScheduler.checkContestStatus();

                const calls = (db.query as jest.Mock).mock.calls;
                const updates = calls
                    .map(([sql, values], i) => ({ sql: String(sql), values, order: (db.query as jest.Mock).mock.invocationCallOrder[i] }))
                    .filter((c) => c.sql.includes('UPDATE contests'));
                expect(updates.map((u) => [u.sql.match(/status = '(\w+)'/)?.[1], u.values])).toEqual([
                    ['running', [10]],
                    ['finishing', [12]],
                    ['finishing', [13]],
                ]);
                const firstMigration = Math.min(...(migrateSubmissionsAfterContest as jest.Mock).mock.invocationCallOrder);
                expect(Math.max(...updates.map((u) => u.order))).toBeLessThan(firstMigration);
                expect((migrateSubmissionsAfterContest as jest.Mock).mock.calls.map((c) => c[0])).toEqual([11, 12, 13]);

                jest.useRealTimers();
            });

            it('waits the full drain on the tick a contest ends and only a few seconds on every retry', async () => {
                expect(typeof RETRY_DRAIN).toBe('number');
                expect(RETRY_DRAIN).toBeGreaterThan(0);
                expect(RETRY_DRAIN).toBeLessThanOrEqual(5_000);
                expect(RETRY_DRAIN).toBeLessThan(FULL_DRAIN);

                const deferred = { success: false, deferred: true, message: 'deferred', migratedSubmissions: 0, finalScoreboard: 0 };
                // Tick 1: the contest ends; its first attempt may wait the full drain.
                (db.query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [] })
                    .mockResolvedValueOnce({ rows: [{ id: 20, title: 'Rush', status: 'running' }] })
                    .mockResolvedValueOnce({});
                (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValueOnce(deferred);
                await contestScheduler.checkContestStatus();
                expect(migrateSubmissionsAfterContest).toHaveBeenLastCalledWith(20, { proceedWithJudgesInFlight: false, drainTimeoutMs: FULL_DRAIN });

                // Tick 2: deferred retry — a short wait, so the tick stays short.
                (db.query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [] })
                    .mockResolvedValueOnce({ rows: [{ id: 20, title: 'Rush', status: 'finishing' }] });
                (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValueOnce(deferred);
                await contestScheduler.checkContestStatus();
                expect(migrateSubmissionsAfterContest).toHaveBeenLastCalledWith(20, { proceedWithJudgesInFlight: false, drainTimeoutMs: RETRY_DRAIN });
                expect((contestScheduler as any).drainDeferrals.get(20)).toBe(2);
            });
        });

        describe('A5-02: judges still in flight at contest end', () => {
            const finishingTick = async (contestId: number, result: unknown, first = false) => {
                (db.query as jest.Mock).mockReset();
                (db.query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [] }) // start scheduled (none)
                    .mockResolvedValueOnce({ rows: [{ id: contestId, title: 'Rush', status: first ? 'running' : 'finishing' }] })
                    .mockResolvedValueOnce({}); // UPDATE to finishing (first tick only)
                (migrateSubmissionsAfterContest as jest.Mock).mockReset();
                (migrateSubmissionsAfterContest as jest.Mock).mockResolvedValueOnce(result);
                await contestScheduler.checkContestStatus();
            };
            const deferred = { success: false, deferred: true, message: 'deferred', migratedSubmissions: 0, finalScoreboard: 0 };

            it('a deferred migration keeps the contest finishing without using up the failure retries', async () => {
                // Far more deferrals than MIGRATION_MAX_RETRIES (5): every tick still tries.
                for (let tick = 0; tick < 10; tick += 1) {
                    await finishingTick(5, deferred, tick === 0);
                    expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(5, expect.objectContaining({ proceedWithJudgesInFlight: false }));
                }
                expect((contestScheduler as any).migrationFailures.get(5)).toBeUndefined();
                expect((contestScheduler as any).drainDeferrals.get(5)).toBe(10);
                const allSql = (db.query as jest.Mock).mock.calls.map((c) => String(c[0]));
                expect(allSql.some((sql) => sql.includes("'finished'"))).toBe(false);

                // Judges drained: the next tick finishes and forgets the deferrals.
                await finishingTick(5, { success: true });
                expect((contestScheduler as any).drainDeferrals.has(5)).toBe(false);
            });

            it('after the deferral budget, finishes anyway with judges in flight', async () => {
                for (let tick = 0; tick < 30; tick += 1) {
                    await finishingTick(6, deferred, tick === 0);
                }
                expect(migrateSubmissionsAfterContest).toHaveBeenLastCalledWith(6, { proceedWithJudgesInFlight: false, drainTimeoutMs: RETRY_DRAIN });

                await finishingTick(6, { success: true });
                expect(migrateSubmissionsAfterContest).toHaveBeenCalledWith(6, { proceedWithJudgesInFlight: true, drainTimeoutMs: RETRY_DRAIN });
                expect(console.error).toHaveBeenCalledWith(
                    expect.stringMatching(/contest judges did not drain within the deferral budget.*contestId=6 .*deferrals=30/),
                );
                expect((contestScheduler as any).drainDeferrals.has(6)).toBe(false);
            });
        });
    });

    describe('pause / resume (DB-05 / A2-03)', () => {
        afterEach(() => {
            contestScheduler.resume();
        });

        it('pause() resolves at once when no tick is running, and paused ticks are skipped', async () => {
            await expect(contestScheduler.pause()).resolves.toBeUndefined();

            await contestScheduler.checkContestStatus();

            expect(db.query).not.toHaveBeenCalled();
        });

        it('pause() resolves only after a tick that was already running has finished', async () => {
            // Independent of query order and of once-values other tests may
            // have queued: answer by SQL text, hold the tick inside the
            // finish migration of one contest whose end time has passed.
            (db.query as jest.Mock).mockReset();
            (migrateSubmissionsAfterContest as jest.Mock).mockReset();
            let releaseMigration!: () => void;
            (migrateSubmissionsAfterContest as jest.Mock).mockImplementation(
                () => new Promise((resolve) => {
                    releaseMigration = () => resolve({ success: true, message: 'ok', migratedSubmissions: 0, finalScoreboard: 0 });
                }),
            );
            (db.query as jest.Mock).mockImplementation(async (sql: string) => (
                /SELECT[\s\S]*end_time/i.test(sql) && /'running'/.test(sql)
                    ? { rows: [{ id: 7, title: 'Slow Contest', status: 'running' }] }
                    : { rows: [], rowCount: 0 }
            ));
            const tick = contestScheduler.checkContestStatus();
            for (let i = 0; i < 50 && (migrateSubmissionsAfterContest as jest.Mock).mock.calls.length === 0; i++) {
                await new Promise((resolve) => setImmediate(resolve));
            }
            expect(migrateSubmissionsAfterContest).toHaveBeenCalledTimes(1);

            let paused = false;
            const pausing = contestScheduler.pause().then(() => { paused = true; });
            await new Promise((resolve) => setImmediate(resolve));
            expect(paused).toBe(false);

            releaseMigration();
            await tick;
            await pausing;
            expect(paused).toBe(true);
        });
    });
});
