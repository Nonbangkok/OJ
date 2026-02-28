const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const db = require('./db');
const cors = require('cors');

const authRoutes = require('./controllers/authController');
const adminRoutes = require('./controllers/adminController');
const problemRoutes = require('./controllers/problemController');
const submissionRoutes = require('./controllers/submissionController');

const contestRoutes = require('./controllers/contestController');
const contestScheduler = require('./services/contestScheduler');

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT;

app.use(express.json());
// app.use(cors({
//   origin: 'https://www.woi-grader.com',
//   // credentials: false,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
// }));

// PostgreSQL session store setup
app.use(session({
  store: new pgSession({
    pool: db.pool, // Use the existing pg pool from db.js
    tableName: 'user_sessions', // Name of the table to store sessions
  }),
  secret: process.env.SECRET_KEY, // Use environment variable
  resave: false,
  saveUninitialized: false,
  cookie: {
    // domain: 'woi-grader.com',
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

app.use('/contests', contestRoutes);
app.use('/admin/contests', contestRoutes);

app.get('/', (req, res) => {
  res.send('Grader System API is running!');
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);

  // Start Contest Scheduler
  try {
    contestScheduler.start();
    console.log('✅ Contest Scheduler initialized successfully');
  } catch (error) {
    console.error('❌ Failed to start Contest Scheduler:', error);
  }
});