import type { Express } from 'express';
import session from 'express-session';
import request from 'supertest';
import bcrypt from 'bcrypt';
import * as db from '../db';
import { parseRuntimeEnv } from '../config/env';

jest.mock('../db');

type CreateApp = (options: {
  runtimeEnv: ReturnType<typeof parseRuntimeEnv>;
  sessionStore: session.Store;
}) => Express;

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://oj:secret@database:5432/oj',
  SECRET_KEY: 'test-secret',
  PGDATABASE: 'oj',
  PGUSER: 'oj',
  PGPASSWORD: 'secret',
  PGHOST: 'database',
  PGPORT: '5432',
};

const loadCreateApp = (): CreateApp => {
  const appModule = require('../app') as { createApp?: CreateApp };
  expect(appModule.createApp).toBeInstanceOf(Function);
  return appModule.createApp!;
};

describe('HTTP runtime configuration', () => {
  it('does not emit cross-origin headers with local defaults', async () => {
    const createApp = loadCreateApp();
    const app = createApp({
      runtimeEnv: parseRuntimeEnv({ ...baseEnv }),
      sessionStore: new session.MemoryStore(),
    });

    const response = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:3001');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('emits credentialed CORS headers only for an allowed origin', async () => {
    const createApp = loadCreateApp();
    const app = createApp({
      runtimeEnv: parseRuntimeEnv({
        ...baseEnv,
        CORS_ORIGINS: 'https://www.woi-grader.com',
      }),
      sessionStore: new session.MemoryStore(),
    });

    const allowed = await request(app)
      .get('/')
      .set('Origin', 'https://www.woi-grader.com');
    const denied = await request(app)
      .get('/')
      .set('Origin', 'https://attacker.example');

    expect(allowed.headers['access-control-allow-origin']).toBe('https://www.woi-grader.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses the configured trust proxy hop count', () => {
    const createApp = loadCreateApp();
    const app = createApp({
      runtimeEnv: parseRuntimeEnv({ ...baseEnv, TRUST_PROXY: '2' }),
      sessionStore: new session.MemoryStore(),
    });

    expect(app.get('trust proxy')).toBe(2);
  });

  it('issues secure domain cookies when production settings request them', async () => {
    const createApp = loadCreateApp();
    const passwordHash = await bcrypt.hash('password123', 10);
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        id: 1,
        username: 'testuser',
        password_hash: passwordHash,
        role: 'user',
      }],
    });

    const app = createApp({
      runtimeEnv: parseRuntimeEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        COOKIE_DOMAIN: 'woi-grader.com',
      }),
      sessionStore: new session.MemoryStore(),
    });

    const response = await request(app)
      .post('/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'testuser', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'][0]).toContain('Domain=woi-grader.com');
    expect(response.headers['set-cookie'][0]).toContain('Secure');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
  });
});

describe('health endpoints', () => {
  const createTestApp = () => loadCreateApp()({
    runtimeEnv: parseRuntimeEnv({ ...baseEnv }),
    sessionStore: new session.MemoryStore(),
  });

  it('reports liveness without querying the database', async () => {
    const response = await request(createTestApp()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('reports readiness when every core table is available', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        users: true,
        system_settings: true,
        user_sessions: true,
        problems: true,
        testcases: true,
        submissions: true,
        contests: true,
        contest_participants: true,
        contest_submissions: true,
        contest_scoreboards: true,
        contest_problems: true,
      }],
    });

    const response = await request(createTestApp()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('reports an unavailable schema when a core table is missing', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        users: true,
        system_settings: true,
        user_sessions: true,
        problems: true,
        testcases: true,
        submissions: true,
        contests: false,
        contest_participants: true,
        contest_submissions: true,
        contest_scoreboards: true,
        contest_problems: true,
      }],
    });

    const response = await request(createTestApp()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'schema_unavailable' });
  });

  it('reports database unavailability without exposing internal errors', async () => {
    (db.query as jest.Mock).mockRejectedValueOnce(new Error('password authentication failed'));

    const response = await request(createTestApp()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'database_unavailable' });
    expect(response.text).not.toContain('password authentication failed');
  });
});
