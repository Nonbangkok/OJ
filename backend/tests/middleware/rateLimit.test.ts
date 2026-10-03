// The general API limiter skips read-heavy authoring workspace routes.
// These guards pin the skip list so new authoring endpoints don't regress
// into 429s during normal admin sessions (as happened with profile-syncs).

type SkipRequest = Parameters<typeof import('../../middleware/rateLimit').skipGeneralLimit>[0];

describe('general API limiter skip paths', () => {
  const OLD_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
    jest.resetModules();
  });

  const skipped = (path: string): boolean => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { skipGeneralLimit } = require('../../middleware/rateLimit') as {
      skipGeneralLimit: (req: SkipRequest) => boolean;
    };
    return skipGeneralLimit({ path } as SkipRequest);
  };

  it('skips a route-agnostic request when the session is staff/admin (revalidated req.user role)', () => {
    process.env.NODE_ENV = 'production';
    const { skipGeneralLimit } = require('../../middleware/rateLimit') as {
      skipGeneralLimit: (req: SkipRequest) => boolean;
    };
    // Simulate what attachRequestUser produces after revalidateSessionUser:
    // the role read is the live users-row role, never a stale session value.
    const userWithRole = (role: string) => ({ user: { role } });
    expect(skipGeneralLimit({ path: '/problems', ...userWithRole('staff') } as SkipRequest)).toBe(true);
    expect(skipGeneralLimit({ path: '/problems', ...userWithRole('admin') } as SkipRequest)).toBe(true);
    // Regression: regular users and guests stay limited.
    expect(skipGeneralLimit({ path: '/problems', ...userWithRole('user') } as SkipRequest)).toBe(false);
    expect(skipGeneralLimit({ path: '/problems', user: undefined } as SkipRequest)).toBe(false);
    expect(skipGeneralLimit({ path: '/problems' } as SkipRequest)).toBe(false);
  });


  it('skips draft, job, profile, and profile-sync workspace traffic', () => {
    expect(skipped('/admin/authoring/drafts/abc')).toBe(true);
    expect(skipped('/admin/authoring/jobs/abc')).toBe(true);
    expect(skipped('/admin/authoring/profile-syncs')).toBe(true);
    expect(skipped('/admin/authoring/profile-syncs/abc')).toBe(true);
    expect(skipped('/admin/author-profiles')).toBe(true);
    expect(skipped('/admin/author-profiles/abc/image')).toBe(true);
  });

  it('skips SSE realtime streams', () => {
    expect(skipped('/realtime/submissions')).toBe(true);
    expect(skipped('/realtime/contests/5')).toBe(true);
  });

  it('does not skip unrelated routes', () => {
    expect(skipped('/problems')).toBe(false);
    expect(skipped('/submit')).toBe(false);
    expect(skipped('/admin/authoring')).toBe(false); // exact mount, no trailing path
    expect(skipped('/realtime')).toBe(false); // exact mount, no trailing path
    expect(skipped('/realtime-thing/other')).toBe(false); // prefix must match a path segment
  });
});

describe('privileged-user rate limit exemptions', () => {
  const OLD_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
    jest.resetModules();
  });

  type Req = { path: string; user?: { role: string } };

  const loadMiddleware = (): {
    skipGeneralLimit: (req: Req) => boolean;
    skipSubmitLimit: (req: Req) => boolean;
    isPrivilegedUser: (req: Req) => boolean;
    authLimiter: { skip?: (req: Req) => boolean };
  } => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../middleware/rateLimit');
  };

  it('exempts staff and admin from the general and submit limiters', () => {
    const { skipGeneralLimit, skipSubmitLimit } = loadMiddleware();
    for (const role of ['staff', 'admin']) {
      const req = { path: '/problems', user: { id: 1, username: 'u', role } } as unknown as Req;
      expect(skipGeneralLimit(req)).toBe(true);
      expect(skipSubmitLimit(req)).toBe(true);
    }
  });

  it('still limits regular users and guests on both limiters (regression)', () => {
    const { skipGeneralLimit, skipSubmitLimit } = loadMiddleware();
    const cases: Req[] = [
      { path: '/problems', user: { role: 'user' } },
      { path: '/problems', user: undefined },
      { path: '/problems' },
    ];
    for (const req of cases) {
      expect(skipGeneralLimit(req)).toBe(false);
      expect(skipSubmitLimit(req)).toBe(false);
    }
  });

  it('reads the role from req.user only (a stale-session claim is not trusted)', () => {
    const { isPrivilegedUser } = loadMiddleware();
    // req.user absent → not privileged, even if a session object exists.
    expect(isPrivilegedUser({ path: '/x', session: { role: 'admin' } } as unknown as Req)).toBe(false);
    // Unknown/garbage roles are not privileged.
    expect(isPrivilegedUser({ path: '/x', user: { role: 'superuser' } } as Req)).toBe(false);
  });

  it('keeps the auth limiter free of any role exemption', async () => {
    // The auth limiter's only skip is the test env: an admin session must
    // still be limited on /login attempts (in practice, after logout). We
    // exercise the real limiter middleware on a throwaway Express app with a
    // requestContext stand-in that populates req.user with an admin role —
    // a role-based skip would return 200 forever; the real limiter must 429
    // once the budget is spent.
    const { authLimiter } = loadMiddleware();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const express = require('express');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const request = require('supertest');
    const app = express();
    app.use((_req: object, _res: object, next: (err?: unknown) => void) => { next(); });
    app.use(authLimiter);
    app.use((_req: object, res: { status: (n: number) => { json: (o: object) => void } }) => {
      res.status(200).json({ ok: true });
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RATE_LIMIT_CONFIG } = require('../../constants');
    const attempts = RATE_LIMIT_CONFIG.AUTH_MAX + 1;
    let finalStatus = 0;
    for (let i = 0; i < attempts; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post('/login');
      finalStatus = r.status;
    }
    expect(finalStatus).toBe(429);
  });
});

describe('proxyClientKey (AUTH-001)', () => {  const keyFor = (headers: Record<string, string | string[] | undefined>, ip?: string): string => {
    const { proxyClientKey } = require('../../middleware/rateLimit') as {
      proxyClientKey: (req: { headers: Record<string, string | string[] | undefined>; ip?: string }) => string;
    };
    return proxyClientKey({ headers, ip });
  };

  it('keys on the proxy-vouched X-Real-IP when present', () => {
    // Even with a fully spoofed XFF, the nginx-set X-Real-IP wins.
    expect(keyFor({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))
      .toBe('rip:' + require('express-rate-limit').ipKeyGenerator('203.0.113.7'));
  });

  it('ignores a spoofed X-Real-IP list (only the string form is honored)', () => {
    // A duplicated header arrives as an array — treated as absent, falling
    // back to req.ip rather than trusting ambiguous client input.
    expect(keyFor({ 'x-real-ip': ['1.1.1.1', '2.2.2.2'] }, '203.0.113.7'))
      .toBe(require('express-rate-limit').ipKeyGenerator('203.0.113.7'));
  });

  it('falls back to req.ip when no X-Real-IP exists (direct/dev traffic)', () => {
    expect(keyFor({}, '127.0.0.1'))
      .toBe(require('express-rate-limit').ipKeyGenerator('127.0.0.1'));
  });
});

describe('per-account login failure throttle (AUTH-001)', () => {
  const {
    isLoginLocked,
    recordLoginFailure,
    clearLoginFailures,
    resetLoginFailureTracker,
  } = require('../../middleware/rateLimit');
  const { RATE_LIMIT_CONFIG } = require('../../constants');

  beforeEach(() => {
    resetLoginFailureTracker();
  });

  it('locks an account after the configured failure count', () => {
    expect(isLoginLocked('alice')).toBe(false);
    for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
      recordLoginFailure('alice');
    }
    expect(isLoginLocked('alice')).toBe(true);
  });

  it('keeps the lock across further failures and resets on success', () => {
    for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
      recordLoginFailure('bob');
    }
    recordLoginFailure('bob');
    expect(isLoginLocked('bob')).toBe(true);

    clearLoginFailures('bob');
    expect(isLoginLocked('bob')).toBe(false);
  });

  it('does not lock other accounts', () => {
    for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
      recordLoginFailure('carol');
    }
    expect(isLoginLocked('carol')).toBe(true);
    expect(isLoginLocked('dave')).toBe(false);
  });

  it('shares a bucket across case/whitespace variants of one username', () => {
    for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
      recordLoginFailure('Eve');
    }
    expect(isLoginLocked('eve')).toBe(true);
    expect(isLoginLocked('  EVE ')).toBe(true);
  });

  it('unlocks after the lockout window passes', () => {
    const now = Date.now();
    for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX; i++) {
      recordLoginFailure('frank', now);
    }
    expect(isLoginLocked('frank', now + 1000)).toBe(true);
    expect(isLoginLocked('frank', now + RATE_LIMIT_CONFIG.LOGIN_LOCKOUT_MS + 1)).toBe(false);
  });
});
