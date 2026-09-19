import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { pool } from './db';
import { env, parseRuntimeEnv } from './config/env';
import { AUTHORING_VALIDATION } from './constants';
import { attachRequestUser } from './middleware/requestContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { generalApiLimiter } from './middleware/rateLimit';
import adminRoutes from './controllers/adminController';
import authRoutes from './controllers/authController';
import problemRoutes from './controllers/problemController';
import submissionRoutes from './controllers/submissionController';
import contestRoutes from './controllers/contestController';
import healthRoutes from './controllers/healthController';
import authoringDraftRoutes from './controllers/authoringDraftController';
import authorProfileRoutes from './controllers/authorProfileController';
import userProfileRoutes from './controllers/userProfileController';
import { createAuthoringJobRouter } from './controllers/authoringJobController';
import authoringTestcaseRoutes from './controllers/authoringTestcaseController';
import authoringWorkspaceRoutes from './controllers/authoringWorkspaceController';

type RuntimeEnv = ReturnType<typeof parseRuntimeEnv>;

type CreateAppOptions = {
  runtimeEnv?: RuntimeEnv;
  sessionStore?: session.Store;
};

const PgStore = pgSession(session);

export const createApp = (options: CreateAppOptions = {}): Express => {
  const runtimeEnv = options.runtimeEnv ?? env;
  const app = express();

  app.set('trust proxy', runtimeEnv.TRUST_PROXY);
  const defaultJsonParser = express.json();
  const authoringJsonParser = express.json({ limit: AUTHORING_VALIDATION.MAX_JSON_BODY_BYTES });
  app.use((req, res, next) => {
    const parser = req.path.startsWith('/admin/authoring/drafts')
      ? authoringJsonParser
      : defaultJsonParser;
    parser(req, res, next);
  });

  if (runtimeEnv.CORS_ORIGINS.length > 0) {
    app.use(cors({
      origin: (origin, callback) => {
        callback(null, origin === undefined || runtimeEnv.CORS_ORIGINS.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
  }

  // Health checks intentionally run before session middleware so liveness does
  // not depend on the database-backed session store.
  app.use('/', healthRoutes);

  const sessionStore = options.sessionStore ?? new PgStore({
    pool,
    tableName: 'user_sessions',
  });
  const sessionMiddleware = session({
    store: sessionStore,
    secret: runtimeEnv.SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      domain: runtimeEnv.COOKIE_DOMAIN,
      secure: runtimeEnv.COOKIE_SECURE,
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
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
  app.use(generalApiLimiter);

  // Router mount order matters: within each router, static segments must be
  // registered before parameterised ones on the same path (e.g. problemRoutes
  // must define /problems-with-stats before /problems/:id). Adding a new router
  // here means its routes join a single global table — check for collisions.
  app.use('/', authRoutes);
  app.use('/', createAuthoringJobRouter(Boolean(runtimeEnv.AUTHORING_JOBS_DIR)));
  app.use('/', authoringTestcaseRoutes);
  app.use('/', authoringWorkspaceRoutes);
  app.use('/', adminRoutes);
  app.use('/', problemRoutes);
  app.use('/', submissionRoutes);
  app.use('/', contestRoutes);
  app.use('/', authoringDraftRoutes);
  app.use('/', authorProfileRoutes);
  app.use('/', userProfileRoutes);

  app.get('/', (_req: Request, res: Response) => {
    res.send('Grader System API is running!');
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
