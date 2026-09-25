import {
  enqueueJudgeTask,
  enqueueTrackedJudgeTask,
  getContestInFlightCount,
  getJudgeQueueStats,
  isSubmissionInFlight,
  resetInFlightTracking,
  waitForContestJudgesToDrain,
} from '../../services/judgeQueue';
import { JUDGE_CONFIG } from '../../constants';

/**
 * Unit tests for the in-process judge concurrency gate (security item B).
 * The gate must cap concurrent judges at JUDGE_CONFIG.MAX_CONCURRENT_JUDGES,
 * queue the excess, and always release its slot — even when a task throws —
 * so the pipeline can never deadlock or spawn unbounded processes.
 */

// A deferred promise whose resolve/reject we control from the test body.
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('judgeQueue concurrency gate', () => {
  const MAX = JUDGE_CONFIG.MAX_CONCURRENT_JUDGES;

  beforeEach(() => {
    // The module is a singleton; confirm we start from a clean slate so state
    // never leaks between tests. (console.error is already silenced + spied by
    // the global tests/setup.ts, so the rejection test can assert on it.)
    expect(getJudgeQueueStats()).toEqual({ running: 0, queued: 0 });
  });

  it('runs at most MAX_CONCURRENT_JUDGES tasks at once and queues the rest', async () => {
    const gates = Array.from({ length: MAX + 2 }, () => deferred());
    let started = 0;
    let maxObservedConcurrent = 0;

    for (const gate of gates) {
      enqueueJudgeTask(async () => {
        started += 1;
        maxObservedConcurrent = Math.max(maxObservedConcurrent, getJudgeQueueStats().running);
        await gate.promise;
      });
    }

    await flush();

    // Only MAX tasks may be running; the remaining 2 must be queued.
    expect(getJudgeQueueStats().running).toBe(MAX);
    expect(getJudgeQueueStats().queued).toBe(2);
    expect(started).toBe(MAX);

    // Release the running tasks one at a time; queued tasks should be pulled in.
    gates[0].resolve();
    await flush();
    expect(started).toBe(MAX + 1);
    expect(getJudgeQueueStats().running).toBe(MAX);

    gates[1].resolve();
    await flush();
    expect(started).toBe(MAX + 2);

    // Release everything and let the queue fully drain.
    for (const gate of gates) gate.resolve();
    await flush();
    await flush();

    expect(maxObservedConcurrent).toBeLessThanOrEqual(MAX);
    expect(getJudgeQueueStats()).toEqual({ running: 0, queued: 0 });
  });

  it('releases the slot and keeps draining when a task rejects', async () => {
    const failing = deferred();
    const followUp = deferred();
    let followUpStarted = false;

    // Fill all slots with failing tasks plus one queued follow-up.
    for (let i = 0; i < MAX; i++) {
      enqueueJudgeTask(async () => {
        await failing.promise;
        throw new Error('boom'); // unexpected throw — gate must not deadlock
      });
    }
    enqueueJudgeTask(async () => {
      followUpStarted = true;
      await followUp.promise;
    });

    await flush();
    expect(getJudgeQueueStats().running).toBe(MAX);
    expect(followUpStarted).toBe(false);

    // All running tasks throw; their slots must be released and the queued
    // follow-up must start despite the rejections.
    failing.resolve();
    await flush();
    await flush();

    expect(followUpStarted).toBe(true);
    expect(console.error).toHaveBeenCalled(); // unexpected throw was logged, not swallowed silently

    followUp.resolve();
    await flush();
    expect(getJudgeQueueStats()).toEqual({ running: 0, queued: 0 });
  });

  it('runs a single task immediately when the gate is idle', async () => {
    const gate = deferred();
    let ran = false;
    enqueueJudgeTask(async () => {
      ran = true;
      await gate.promise;
    });

    await flush();
    expect(ran).toBe(true);
    expect(getJudgeQueueStats()).toEqual({ running: 1, queued: 0 });

    gate.resolve();
    await flush();
    expect(getJudgeQueueStats()).toEqual({ running: 0, queued: 0 });
  });

  describe('tracked tasks + in-flight registry (JUDGE-004/005)', () => {
    beforeEach(() => {
      resetInFlightTracking();
    });

    it('marks a submission in-flight while queued and running, released on settle', async () => {
      const gate = deferred();
      const key = { table: 'submissions' as const, submissionId: 7 };
      enqueueTrackedJudgeTask(async () => { await gate.promise; }, key);

      // Registered immediately (queued counts as in-flight).
      expect(isSubmissionInFlight(key)).toBe(true);
      await flush();
      expect(isSubmissionInFlight(key)).toBe(true);

      gate.resolve();
      await flush();
      await flush();
      expect(isSubmissionInFlight(key)).toBe(false);
    });

    it('releases the in-flight registration even when the task throws', async () => {
      const key = { table: 'contest_submissions' as const, submissionId: 9 };
      enqueueTrackedJudgeTask(async () => { throw new Error('boom'); }, key, 3);

      await flush();
      await flush();
      expect(isSubmissionInFlight(key)).toBe(false);
      expect(getContestInFlightCount(3)).toBe(0);
    });

    it('tracks per-contest counts for drain coordination and releases them', async () => {
      expect(getContestInFlightCount(5)).toBe(0);
      const gates = [deferred(), deferred()];
      enqueueTrackedJudgeTask(async () => { await gates[0].promise; }, { table: 'contest_submissions', submissionId: 1 }, 5);
      enqueueTrackedJudgeTask(async () => { await gates[1].promise; }, { table: 'contest_submissions', submissionId: 2 }, 5);
      // A standalone-pool row with no contest is not counted anywhere.
      const standaloneGate = deferred();
      enqueueTrackedJudgeTask(async () => { await standaloneGate.promise; }, { table: 'submissions', submissionId: 3 });

      await flush();
      expect(getContestInFlightCount(5)).toBe(2);

      gates[0].resolve();
      await flush();
      expect(getContestInFlightCount(5)).toBe(1);

      gates[1].resolve();
      standaloneGate.resolve();
      await flush();
      expect(getContestInFlightCount(5)).toBe(0);
    });

    it('waits for a contest to drain and resolves once idle', async () => {
      const gate = deferred();
      enqueueTrackedJudgeTask(async () => { await gate.promise; }, { table: 'contest_submissions', submissionId: 1 }, 8);

      const draining = waitForContestJudgesToDrain(8, 5000);
      gate.resolve();
      await expect(draining).resolves.toBe(true);
    });

    it('resolve false when the drain timeout elapses with judges still running', async () => {
      const gate = deferred();
      enqueueTrackedJudgeTask(async () => { await gate.promise; }, { table: 'contest_submissions', submissionId: 1 }, 9);

      const draining = waitForContestJudgesToDrain(9, 0);
      await expect(draining).resolves.toBe(false);

      gate.resolve();
      await flush();
    });
  });
});
