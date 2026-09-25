import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { RATE_LIMIT_CONFIG } from '../constants';

// Rate limiting must never interfere with the jest+supertest suite.
const isTestEnv = (_req: Request): boolean => process.env.NODE_ENV === 'test';

const tooManyRequests = (message: string) => ({ message });

/**
 * The client IP the reverse proxy vouches for, NOT the client-supplied
 * X-Forwarded-For (AUTH-001).
 *
 * nginx is configured to overwrite X-Real-IP and X-Forwarded-For with its
 * own $remote_addr on every /api/ request (see nginx-proxy/*.conf), so
 * req.ip — derived from those headers under `trust proxy` — is already the
 * proxy-vouched address. X-Real-IP is read directly as a belt-and-braces
 * second source for deployments where the proxy sets it but the XFF
 * rewrite is missed: if a client spoofs XFF and the proxy only overwrote
 * X-Real-IP, keying on req.ip alone would still key on the spoofed value.
 *
 * Callers that have no proxy in front (dev, tests) have no X-Real-IP and an
 * unsullied XFF, so the req.ip fallback is correct there.
 */
export const proxyClientKey = (req: Request): string => {
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return `rip:${ipKeyGenerator(realIp)}`;
  }
  return ipKeyGenerator(req.ip ?? '');
};

/**
 * General API limiter — applied to every request before routing.
 * Read-heavy authoring workspace traffic (draft/job polling and the debounced
 * statement preview) is excluded: a single editing session legitimately issues
 * several requests per second, far above a general browsing budget, and each
 * excluded route is an authenticated admin endpoint with its own bounded cost.
 * SSE realtime streams are excluded too — each is one long-lived request per
 * open page, not a request budget item.
 */
const GENERAL_LIMIT_SKIP_PATHS = [
  '/admin/authoring/drafts/', // GET polling + PATCH saves + preview renders
  '/admin/authoring/jobs/', // job status polls
  '/admin/authoring/profile-syncs', // sync run cascade view (list + detail polls)
  '/admin/author-profiles', // profile list/images — loaded alongside the workspace
  '/realtime/', // SSE streams — one request per page view, held open indefinitely
] as const;

/** Exported for tests: pins the workspace routes excluded from the general limiter. */
export const skipGeneralLimit = (req: Request): boolean => {
  if (isTestEnv(req)) return true;
  return GENERAL_LIMIT_SKIP_PATHS.some((prefix) => req.path.startsWith(prefix));
};

export const generalApiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.GENERAL_WINDOW_MS,
  max: RATE_LIMIT_CONFIG.GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipGeneralLimit,
  // Key on the proxy-vouched client address, not the spoofable XFF leftmost
  // entry (AUTH-001).
  keyGenerator: proxyClientKey,
  message: tooManyRequests('Too many requests, please try again later.'),
});

/**
 * Strict limiter for auth endpoints (/login, /register) to slow brute force.
 * Keyed by the proxy-vouched client IP; per-account lockout on top of this
 * lives in the login failure tracker below.
 */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.AUTH_WINDOW_MS,
  max: RATE_LIMIT_CONFIG.AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
  keyGenerator: proxyClientKey,
  message: tooManyRequests('Too many authentication attempts, please try again later.'),
});

/**
 * Strict limiter for the /submit endpoint to mitigate submission-spam DoS.
 * Keyed by authenticated user id when available, otherwise by IP.
 */
export const submitLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.SUBMIT_WINDOW_MS,
  max: RATE_LIMIT_CONFIG.SUBMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
  keyGenerator: (req: Request): string => {
    const userId = req.session?.userId;
    if (typeof userId === 'number') {
      return `user:${userId}`;
    }
    // Fall back to the proxy-vouched client address.
    return proxyClientKey(req);
  },
  message: tooManyRequests('You are submitting too quickly, please slow down.'),
});

/**
 * Per-account login failure throttle (AUTH-001).
 *
 * IP-keyed limiters are defeated by rotating spoofed IPs; a per-username
 * counter is not. After LOGIN_FAILURE_MAX failed passwords for one username
 * within the window, that account is locked out for LOGIN_LOCKOUT_MS
 * regardless of source IP. Successful login clears the counter. The tracker
 * is in-memory: it resets on backend restart, which only shortens a lockout.
 *
 * Best-effort by design (no DB write per guess), but it caps online guessing
 * at ~LOGIN_FAILURE_MAX attempts per window per account even for an attacker
 * with unlimited IPs.
 */
interface FailureEntry {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const loginFailures = new Map<string, FailureEntry>();

const isExpired = (entry: FailureEntry, now: number): boolean =>
  entry.lockedUntil <= now
  && now - entry.windowStart >= RATE_LIMIT_CONFIG.LOGIN_FAILURE_WINDOW_MS;

const evictStaleEntries = (now: number): void => {
  if (loginFailures.size <= RATE_LIMIT_CONFIG.LOGIN_TRACKER_MAX_ACCOUNTS) {
    return;
  }
  for (const [key, entry] of loginFailures) {
    if (isExpired(entry, now)) {
      loginFailures.delete(key);
    }
  }
};

/** Normalized account key: trim + lowercase so case variants share a bucket. */
const accountKey = (username: string): string => username.trim().toLowerCase();

export const isLoginLocked = (username: string, now: number = Date.now()): boolean => {
  const entry = loginFailures.get(accountKey(username));
  return entry !== undefined && entry.lockedUntil > now;
};

export const recordLoginFailure = (username: string, now: number = Date.now()): void => {
  const key = accountKey(username);
  evictStaleEntries(now);

  const current = loginFailures.get(key);
  if (current === undefined || isExpired(current, now)) {
    loginFailures.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }

  current.count += 1;
  if (current.count >= RATE_LIMIT_CONFIG.LOGIN_FAILURE_MAX) {
    current.lockedUntil = now + RATE_LIMIT_CONFIG.LOGIN_LOCKOUT_MS;
  }
};

export const clearLoginFailures = (username: string): void => {
  loginFailures.delete(accountKey(username));
};

/** Exported for tests: wipe all tracker state. */
export const resetLoginFailureTracker = (): void => {
  loginFailures.clear();
};
