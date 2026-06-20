import express, { Request, Response } from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { pool } from './db';
import { attachRequestUser } from './middleware/requestContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { generalApiLimiter } from './middleware/rateLimit';
import { env } from './config/env';
// import cors from 'cors';

// Import routes (Assuming they will be converted or handled by TS)
import adminRoutes from './controllers/adminController';
import authRoutes from './controllers/authController';
import problemRoutes from './controllers/problemController';
import submissionRoutes from './controllers/submissionController';
import contestRoutes from './controllers/contestController';
import contestScheduler from './services/contestScheduler';

const app = express();
const PgStore = pgSession(session);

app.set('trust proxy', 1);
const port = Number(env.PORT) || 5000;

app.use(express.json());
// app.use(cors({
//   origin: 'https://www.woi-grader.com',
//   // credentials: false,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
// }));

// PostgreSQL session store setup
const sessionMiddleware = session({
  store: new PgStore({
    pool: pool, // Use the existing pg pool from db.ts
    tableName: 'user_sessions', // Name of the table to store sessions
  }),
  secret: env.SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true for production
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

// Database import progress must remain readable while the import temporarily
// drops the session table.
app.use((req, res, next) => {
  if (req.path.startsWith('/admin/database/import-progress/')) {
    next();
    return;
  }
  sessionMiddleware(req, res, next);
});

app.use(attachRequestUser);

// General API rate limiter — mounted before routes. Stricter per-route limiters
// (auth, submit) are applied inside their controllers. `trust proxy` (set above)
// ensures the real client IP is used behind the nginx reverse proxy.
app.use(generalApiLimiter);

app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', problemRoutes);
app.use('/', submissionRoutes);
app.use('/', contestRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Grader System API is running!');
});

app.use(notFoundHandler);
app.use(errorHandler);

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
