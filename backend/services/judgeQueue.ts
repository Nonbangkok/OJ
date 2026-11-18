import { JUDGE_CONFIG } from '../constants';

/**
 * In-process concurrency gate for the judging pipeline.
 *
 * Submissions are accepted immediately (the controller returns 202), but the
 * actual compile/run work is dispatched here so that at most
 * `JUDGE_CONFIG.MAX_CONCURRENT_JUDGES` judges run at once. Excess work is held
 * in a FIFO queue and started as running slots free up. This prevents a burst
 * of submissions from spawning unbounded g++/judge processes (a DoS vector).
 *
 * This is intentionally a single-process gate; it does not coordinate across
 * multiple backend instances.
 */

type JudgeTask = () => Promise<void>;

/** Identity of one judging unit: which pool the row lives in + its id. */
export interface JudgeTaskKey {
  table: 'submissions' | 'contest_submissions';
  submissionId: number;
}

/** String form of a JudgeTaskKey (its in-flight registry key). */
const keyToString = (key: JudgeTaskKey): string => `${key.table}:${key.submissionId}`;

let running = 0;
const queue: JudgeTask[] = [];
/** Submission rows with a task currently queued OR running (JUDGE-004). */
const inFlight = new Set<string>();
/** Per-contest count of in-flight (queued or running) judge tasks (JUDGE-005). */
const inFlightByContest = new Map<number, number>();
/** A2-03: while paused (database import), queued tasks wait and nothing new starts. */
let paused = false;

function pump(): void {
  while (!paused && running < JUDGE_CONFIG.MAX_CONCURRENT_JUDGES && queue.length > 0) {
    const task = queue.shift();
    if (!task) {
      break;
    }
    running += 1;
    // Run the task; always release the slot and pump again when it settles.
    void Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        // Tasks own their error handling, but guard against an unexpected throw
        // so the gate never deadlocks.
        console.error('Unhandled error in queued judge task:', error);
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/**
 * Enqueue a judge task. If a slot is free the task starts on the next tick;
 * otherwise it waits in the FIFO queue. Returns immediately (fire-and-forget).
 */
export function enqueueJudgeTask(task: JudgeTask): void {
  queue.push(task);
  pump();
}

/**
 * Enqueue a judge task for a specific submission row, registering it as
 * in-flight for the whole queued+running lifetime (JUDGE-004). While a judge
 * for the row is in flight, `isSubmissionInFlight` returns true — rejudge
 * uses that to refuse doubling work on a row the judge is already processing.
 * `contestId` (contest-pool rows only) additionally feeds the per-contest
 * in-flight count that contest-end migration drains against (JUDGE-005).
 */
export function enqueueTrackedJudgeTask(
  task: JudgeTask,
  key: JudgeTaskKey,
  contestId?: number
): void {
  const keyStr = keyToString(key);
  inFlight.add(keyStr);
  if (contestId !== undefined) {
    inFlightByContest.set(contestId, (inFlightByContest.get(contestId) ?? 0) + 1);
  }
  const release = (): void => {
    inFlight.delete(keyStr);
    if (contestId !== undefined) {
      const remaining = (inFlightByContest.get(contestId) ?? 0) - 1;
      if (remaining <= 0) {
        inFlightByContest.delete(contestId);
      } else {
        inFlightByContest.set(contestId, remaining);
      }
    }
  };
  enqueueJudgeTask(async () => {
    try {
      await task();
    } finally {
      release();
    }
  });
}

/** True while a judge task for this exact row is queued or running (JUDGE-004). */
export function isSubmissionInFlight(key: JudgeTaskKey): boolean {
  return inFlight.has(keyToString(key));
}

/** Number of queued or running judge tasks for a contest (JUDGE-005). */
export function getContestInFlightCount(contestId: number): number {
  return inFlightByContest.get(contestId) ?? 0;
}

/**
 * Wait until no judge tasks remain in flight for the contest, resolving as
 * soon as the count hits zero (JUDGE-005). Resolves false if the timeout
 * (ms) elapses first — callers then decide whether to defer or proceed.
 * Polls rather than callbacks: the queue's slot bookkeeping lives inside
 * task wrappers, and a short poll interval keeps this race-free without
 * threading release notifications through the pump.
 */
export async function waitForContestJudgesToDrain(
  contestId: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (getContestInFlightCount(contestId) > 0) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, JUDGE_CONFIG.DRAIN_POLL_INTERVAL_MS));
  }
  return true;
}

/**
 * A2-03: hold the queue for a database import. Running tasks finish; queued
 * and newly enqueued tasks wait until resumeJudgeQueue().
 */
export function pauseJudgeQueue(): void {
  paused = true;
}

/** Undo pauseJudgeQueue() and start whatever is queued (idempotent). */
export function resumeJudgeQueue(): void {
  paused = false;
  pump();
}

/**
 * A2-03: wait until no judge task is running (queued ones stay held while
 * the queue is paused). Resolves false when the timeout (ms) elapses first.
 * Polls like waitForContestJudgesToDrain.
 */
export async function waitForRunningJudgesToSettle(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (running > 0) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, JUDGE_CONFIG.DRAIN_POLL_INTERVAL_MS));
  }
  return true;
}

/**
 * A2-03/A2-04: after a database import replaced every row, the queued tasks
 * point at ids that now mean other submissions. Drop them and the in-flight
 * registry; the caller re-enqueues the restored Pending rows with
 * sweepOrphanedSubmissions(). Only call while paused with nothing running.
 * Returns how many queued tasks were dropped.
 */
export function discardQueuedJudgeTasks(): number {
  const discarded = queue.length;
  queue.length = 0;
  inFlight.clear();
  inFlightByContest.clear();
  return discarded;
}

/** Test/observability helper: current number of running + queued tasks. */
export function getJudgeQueueStats(): { running: number; queued: number } {
  return { running, queued: queue.length };
}

/** Test helper: forget all in-flight registrations (jest module reset). */
export function resetInFlightTracking(): void {
  inFlight.clear();
  inFlightByContest.clear();
}
