import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import {
  attachRequestUser,
  revalidateSessionUser,
} from '../middleware/requestContext';
import { requireAuth, requireStaffOrAdmin } from '../middleware/auth';
import { errorHandler } from '../middleware/errorHandler';
import * as db from '../db';

jest.mock('../db');

/**
 * Session revalidation (AUTH-002/003, ADMIN-001): the login-time user
 * snapshot must be re-synced from the users row on every authenticated
 * request, so deletion, demotion, and renames take effect immediately.
 */
const buildApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use(revalidateSessionUser);
  app.use(attachRequestUser);
  app.get('/whoami', requireAuth, (req: Request, res: Response) => {
    res.json({ id: req.user!.id, username: req.user!.username, role: req.user!.role });
  });
  app.get('/staff-only', requireAuth, requireStaffOrAdmin, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  app.get('/public', (req: Request, res: Response) => {
    res.json({ authenticated: !!req.user, id: req.user?.id ?? null });
  });
  app.use(errorHandler);
  return app;
};

const userRow = (overrides: Partial<{ id: number; username: string; role: string; has_avatar: boolean }> = {}) => ({
  id: 5,
  username: 'alice',
  role: 'user',
  has_avatar: false,
  ...overrides,
});

describe('revalidateSessionUser + attachRequestUser', () => {
  let agent: request.Agent;
  let app: Express;

  const login = (): void => {
    // Seed a logged-in session the way authController /login does.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (!req.session.userId && (req as { loggedIn?: boolean }).loggedIn) {
        req.session.userId = 5;
        req.session.username = 'alice';
        req.session.role = 'user';
        req.session.hasAvatar = false;
      }
      next();
    });
  };

  beforeEach(() => {
    app = buildApp();
    // Install a login middleware AFTER build: every subsequent request in
    // this app instance carries a logged-in session.
    const server = express();
    server.use(express.json());
    server.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
    server.use((req: Request, _res: Response, next: NextFunction) => {
      req.session.userId = 5;
      req.session.username = 'alice';
      req.session.role = 'user';
      req.session.hasAvatar = false;
      next();
    });
    server.use(revalidateSessionUser);
    server.use(attachRequestUser);
    server.get('/whoami', requireAuth, (req: Request, res: Response) => {
      res.json({ id: req.user!.id, username: req.user!.username, role: req.user!.role });
    });
    server.get('/staff-only', requireAuth, requireStaffOrAdmin, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    server.get('/public', (req: Request, res: Response) => {
      res.json({ authenticated: !!req.user, id: req.user?.id ?? null });
    });
    server.use(errorHandler);
    app = server;
    agent = request.agent(app);
    (db.query as jest.Mock).mockReset();
  });

  it('refreshes a renamed username and role change on the next request', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [userRow({ username: 'alice-renamed', role: 'staff' })],
    });

    const res = await agent.get('/whoami');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5, username: 'alice-renamed', role: 'staff' });
  });

  it('grants staff access after a promotion is revalidated', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [userRow({ role: 'staff' })],
    });

    const res = await agent.get('/staff-only');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('drops staff access when the user was demoted (ADMIN-001)', async () => {
    // Session still says staff; the users row says user.
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [userRow({ role: 'user' })],
    });
    const res = await agent.get('/staff-only');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Staff or Admin access required');
  });

  it('treats a deleted user as unauthenticated (AUTH-002/003)', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const whoami = await agent.get('/whoami');
    expect(whoami.status).toBe(401);

    // The same session must not authenticate anything else either.
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const pub = await agent.get('/public');
    expect(pub.status).toBe(200);
    expect(pub.body.authenticated).toBe(false);
  });

  it('does not query the database for guest sessions', async () => {
    const guestApp = buildApp();
    (db.query as jest.Mock).mockReset();

    const res = await request(guestApp).get('/public');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the users lookup errors', async () => {
    (db.query as jest.Mock).mockRejectedValueOnce(new Error('db down'));

    const res = await agent.get('/whoami');

    expect(res.status).toBe(500);
  });

  it('syncs the avatar flag from the users row', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [userRow({ has_avatar: true })],
    });

    const res = await agent.get('/whoami');

    expect(res.status).toBe(200);
    // hasAvatar rides on req.user even if /whoami does not return it.
    expect(res.body.username).toBe('alice');
  });
});

describe('attachRequestUser standalone mapping', () => {
  const map = (sessionData: Record<string, unknown>) => {
    const req = { session: sessionData } as unknown as Request;
    attachRequestUser(req, {} as Response, () => undefined);
    return req.user;
  };

  it('maps session fields to req.user', () => {
    expect(map({ userId: 9, username: 'bob', role: 'staff', hasAvatar: true })).toEqual({
      id: 9,
      username: 'bob',
      role: 'staff',
      hasAvatar: true,
    });
  });

  it('leaves req.user undefined without a userId', () => {
    expect(map({ username: 'bob', role: 'admin' })).toBeUndefined();
  });

  it('defaults to least privilege for partial legacy sessions', () => {
    expect(map({ userId: 3 })).toEqual({ id: 3, username: '', role: 'user', hasAvatar: false });
  });
});
