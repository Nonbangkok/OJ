import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { RATE_LIMIT_CONFIG } from '../constants';

// Rate limiting must never interfere with the jest+supertest suite.
const isTestEnv = (_req: Request): boolean => process.env.NODE_ENV === 'test';

const tooManyRequests = (message: string) => ({ message });

/**
 * General API limiter — applied to every request before routing.
 * Behind the nginx reverse proxy `app.set('trust proxy', 1)` is set so the
 * client IP is read from the X-Forwarded-For header.
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
  message: tooManyRequests('Too many requests, please try again later.'),
});

/**
 * Strict limiter for auth endpoints (/login, /register) to slow brute force.
 * Keyed by IP.
 */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.AUTH_WINDOW_MS,
  max: RATE_LIMIT_CONFIG.AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
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
    // Fall back to the IPv6-safe IP key generator.
    return ipKeyGenerator(req.ip ?? '');
  },
  message: tooManyRequests('You are submitting too quickly, please slow down.'),
});
