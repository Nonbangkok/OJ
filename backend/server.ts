import { createApp } from './app';
import { env } from './config/env';
import contestScheduler from './services/contestScheduler';
import { startAuthoringCoordinator } from './services/authoringJobCoordinator';
import { sweepOrphanedSubmissions } from './services/submissionService';
import { logger } from './utils/logger';
import { initBackendWorkRoot } from './utils/privateTemp';

// Every backend temp file lives under a private 0700 work root (judged
// programs share this container's /tmp). Refuse to start if OJ_WORK_DIR is
// not a real directory owned by this uid with mode 0700.
try {
  const workRoot = initBackendWorkRoot({ removeStaleOwnPid: true });
  logger.info('backend work root ready', { workRoot });
} catch (error) {
  logger.error('refusing to start: backend work root is not private', { err: error });
  process.exit(1);
}

const app = createApp();
const port = Number(env.PORT) || 5000;
if (env.AUTHORING_JOBS_DIR) {
  startAuthoringCoordinator(env.AUTHORING_JOBS_DIR).then(stop => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => { stop(); process.exit(0); });
    }
  }).catch(() => {
    logger.error('unable to initialize authoring transport');
    process.exit(1);
  });
}
app.listen(port, () => {
  logger.info('server listening', { port });

  // JUDGE-003 / DB-13: recover submissions orphaned in a non-terminal state
  // by the previous process (the judge queue is in-memory). Pending rows are
  // re-enqueued; Compiling/Running rows are marked System Error. Runs after
  // listen so a sweep failure never blocks startup; failures are logged.
  sweepOrphanedSubmissions().catch((error) => {
    logger.error('startup submission sweep failed', { err: error });
  });

  // Start Contest Scheduler
  try {
    if (contestScheduler && typeof contestScheduler.start === 'function') {
      contestScheduler.start();
      logger.info('contest scheduler initialized');
    }
  } catch (error) {
    logger.error('failed to start contest scheduler', { err: error });
  }
});
