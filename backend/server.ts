import { createApp } from './app';
import { env } from './config/env';
import contestScheduler from './services/contestScheduler';

const app = createApp();
const port = Number(env.PORT) || 5000;

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
