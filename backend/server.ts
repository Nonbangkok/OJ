import express, { Request, Response } from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { pool } from './db';
// import cors from 'cors';

// Import routes (Assuming they will be converted or handled by TS)
import adminRoutes from './controllers/adminController';
import authRoutes from './controllers/authController';
import problemRoutes from './controllers/problemController';
import submissionRoutes from './controllers/submissionController';
import contestRoutes from './controllers/contestController';
const contestScheduler = require('./services/contestScheduler');

const app = express();
const PgStore = pgSession(session);

app.set('trust proxy', 1);
const port = process.env.PORT || 5000;

app.use(express.json());
// app.use(cors({
//   origin: 'https://www.woi-grader.com',
//   // credentials: false,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
// }));

// PostgreSQL session store setup
app.use(session({
  store: new PgStore({
    pool: pool, // Use the existing pg pool from db.ts
    tableName: 'user_sessions', // Name of the table to store sessions
  }),
  secret: process.env.SECRET_KEY || 'secret', // Use environment variable
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true for production
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', problemRoutes);
app.use('/', submissionRoutes);
app.use('/', contestRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Grader System API is running!');
});

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