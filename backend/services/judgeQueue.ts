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

let running = 0;
const queue: JudgeTask[] = [];

function pump(): void {
  while (running < JUDGE_CONFIG.MAX_CONCURRENT_JUDGES && queue.length > 0) {
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

/** Test/observability helper: current number of running + queued tasks. */
export function getJudgeQueueStats(): { running: number; queued: number } {
  return { running, queued: queue.length };
}
