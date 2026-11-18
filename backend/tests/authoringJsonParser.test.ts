import type { Express } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { once } from 'events';
import session from 'express-session';
import request from 'supertest';
import * as db from '../db';
import { parseRuntimeEnv } from '../config/env';
import { AUTHORING_VALIDATION } from '../constants';

jest.mock('../db');

// The 7 MiB authoring JSON parser used to be chosen by path in app.ts and run
// before any auth, so an anonymous client could make the server inflate and
// JSON.parse up to 7 MiB per request on /admin/authoring/drafts/* before the
// router's requireAuth answered 401 (and the general limiter skipped the
// path for everyone). The large parser now runs only after requireAuth +
// requireStaffOrAdmin; everyone else is refused before the body is read.

type CreateApp = (options: {
  runtimeEnv: ReturnType<typeof parseRuntimeEnv>;
  sessionStore: session.Store;
}) => Express;

const SECRET = 'test-secret';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://oj:secret@database:5432/oj',
  SECRET_KEY: SECRET,
  PGDATABASE: 'oj',
  PGUSER: 'oj',
  PGPASSWORD: 'secret',
  PGHOST: 'database',
  PGPORT: '5432',
};

const loadCreateApp = (): CreateApp => (require('../app') as { createApp: CreateApp }).createApp;

const MiB = 1024 * 1024;
const DRAFT_ID = '00000000-0000-4000-8000-000000000001';
// ~1 MiB, well above the 100 KB default limit, and deliberately not valid
// JSON: a 400 here can only come from the large parser having run.
const malformedLargeBody = '{"statementHtml":"' + 'a'.repeat(MiB);

type Role = 'staff' | 'admin' | 'user';

/** An app plus a signed session cookie for a logged-in user of `role` (revalidated against the mocked users row). */
const buildApp = async (role?: Role): Promise<{ app: Express; cookie?: string }> => {
  const store = new session.MemoryStore();
  const app = loadCreateApp()({ runtimeEnv: parseRuntimeEnv({ ...baseEnv }), sessionStore: store });
  (db.query as jest.Mock).mockReset().mockImplementation(async (sql: string) => (
    role && sql.includes('FROM users WHERE id = $1')
      ? { rows: [{ id: 7, username: 'u7', role, has_avatar: false, submissions_locked: false }] }
      : { rows: [], rowCount: 0 }
  ));
  if (!role) return { app };

  const sid = `sid-${role}`;
  const expires = new Date(Date.now() + 60_000);
  await new Promise<void>((resolve, reject) => {
    store.set(sid, {
      cookie: { originalMaxAge: 60_000, expires, httpOnly: true, path: '/' },
      userId: 7,
      username: 'u7',
      role,
    } as unknown as session.SessionData, (error?: unknown) => (error ? reject(error) : resolve()));
  });
  const { sign } = require('cookie-signature') as { sign: (value: string, secret: string) => string };
  return { app, cookie: `connect.sid=${encodeURIComponent(`s:${sign(sid, SECRET)}`)}` };
};

/**
 * PATCH a JSON body on a keep-alive connection, as nginx talks to the backend
 * (proxy_http_version 1.1, Connection ''). The refusal arrives before the
 * body has been read; on a keep-alive connection Node drains the rest, while
 * on a `Connection: close` one it would drop the socket mid-upload.
 */
const patchRaw = async (app: Express, path: string, body: string, cookie?: string): Promise<{ status: number; body: unknown }> => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true });
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'PATCH',
        path,
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        });
      });
      req.on('error', reject);
      req.end(body);
    });
  } finally {
    agent.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};

describe('authoring draft JSON parser', () => {
  it('refuses a large anonymous body on /admin/authoring/drafts/* without parsing it', async () => {
    const { app } = await buildApp();

    const res = await patchRaw(app, `/admin/authoring/drafts/${DRAFT_ID}`, malformedLargeBody);

    expect(res.status).toBe(401);
  });

  it('refuses a small anonymous body with 401 as before', async () => {
    const { app } = await buildApp();

    const res = await request(app).post('/admin/authoring/drafts').send({ statementHtml: 'a'.repeat(128 * 1024) });

    expect(res.status).toBe(401);
  });

  it('refuses a user-role session with 403 without parsing its body', async () => {
    const { app, cookie } = await buildApp('user');

    const res = await patchRaw(app, `/admin/authoring/drafts/${DRAFT_ID}`, malformedLargeBody, cookie);

    expect(res.status).toBe(403);
  });

  it('parses a large body for a staff session (malformed JSON is a 400, not a 413)', async () => {
    const { app, cookie } = await buildApp('staff');

    const res = await request(app)
      .patch(`/admin/authoring/drafts/${DRAFT_ID}`)
      .set('Cookie', cookie!)
      .set('Content-Type', 'application/json')
      .send(malformedLargeBody);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Malformed JSON request body' });
  });

  it('gives the large limit to the other authoring routers under the drafts prefix', async () => {
    const { app, cookie } = await buildApp('admin');

    const res = await request(app)
      .post(`/admin/authoring/drafts/${DRAFT_ID}/preview`)
      .set('Cookie', cookie!)
      .send({ statementHtml: 'a'.repeat(MiB) });

    // Parsed and validated, then the (mocked) draft lookup finds nothing.
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'draft_not_found' });
  });

  it('still caps a staff body at the authoring limit', async () => {
    const { app, cookie } = await buildApp('staff');

    const res = await request(app)
      .patch(`/admin/authoring/drafts/${DRAFT_ID}`)
      .set('Cookie', cookie!)
      .set('Content-Type', 'application/json')
      .send(`{"statementHtml":"${'a'.repeat(AUTHORING_VALIDATION.MAX_JSON_BODY_BYTES)}"}`);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ message: 'JSON request body is too large' });
  });

  it('keeps the 100 KB default for a staff session outside the authoring drafts prefix', async () => {
    const { app, cookie } = await buildApp('staff');

    const res = await request(app)
      .put('/admin/problems/P1')
      .set('Cookie', cookie!)
      .send({ title: 'a'.repeat(128 * 1024) });

    expect(res.status).toBe(413);
  });

  it('answers malformed JSON on an ordinary route with a 400', async () => {
    const { app } = await buildApp();

    const res = await request(app)
      .post('/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Malformed JSON request body' });
  });
});
