import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { RATE_LIMIT_CONFIG } from '../constants';

// Rate limiting must never interfere with the jest+supertest suite.
const isTestEnv = (): boolean => process.env.NODE_ENV === 'test';

const tooManyRequests = (message: string) => ({ message });

/**
 * General API limiter — applied to every request before routing.
 * Behind the nginx reverse proxy `app.set('trust proxy', 1)` is set so the
 * client IP is read from the X-Forwarded-For header.
 */
export const generalApiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.GENERAL_WINDOW_MS,
  max: RATE_LIMIT_CONFIG.GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
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
