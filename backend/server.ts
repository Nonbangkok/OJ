import { createApp } from './app';
import { env } from './config/env';
import contestScheduler from './services/contestScheduler';
import { startAuthoringCoordinator } from './services/authoringJobCoordinator';

const app = createApp();
const port = Number(env.PORT) || 5000;
if (env.AUTHORING_JOBS_DIR) {
  startAuthoringCoordinator(env.AUTHORING_JOBS_DIR).then(stop => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => { stop(); process.exit(0); });
    }
  }).catch(() => {
    console.error('Unable to initialize authoring transport');
    process.exit(1);
  });
}
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);

  // Start Contest Scheduler
  try {
    if (contestScheduler && typeof contestScheduler.start === 'function') {
      contestScheduler.start();
      console.log('✅ Contest Scheduler initialized successfully');
    }
  } catch (error) {
    console.error('❌ Failed to start Contest Scheduler:', error);
  }
});
