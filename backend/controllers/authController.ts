import express, { Request, Response, Router } from 'express';
import bcrypt from 'bcrypt';
import * as db from '../db';
import { SECURITY_CONFIG } from '../constants';
import { UserPublicProfileDTO, UserRow } from '../types/models';
import {
  ChangePasswordRequestBody,
  LoginRequestBody,
  LoginSuccessResponse,
  MeResponse,
  MessageResponse,
  RegisterRequestBody,
  RegisterSuccessResponse,
  RegistrationStatusResponse,
} from '../types/api';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { getPasswordChangeEnabled, getSiteAccessMode } from '../services/siteSettingsService';
import { changeOwnPassword } from '../services/adminQueryService';
import { validateRequest } from '../middleware/validation';
import {
  authLimiter,
  clearLoginFailures,
  isLoginLocked,
  recordLoginFailure,
} from '../middleware/rateLimit';
import { changePasswordSchema, loginSchema, registerSchema } from '../schemas/requestSchemas';
import { getUserTierAndLevel } from '../services/progressionService';
import { isUniqueViolation } from '../utils/dbErrors';
import { logger } from '../utils/logger';

const router: Router = express.Router();

const destroySession = (req: Request): Promise<void> => {
  return new Promise((resolve, reject) => {
    req.session.destroy((error: unknown) => {
      if (error) {
        reject(new AppError('Error logging out', 500));
        return;
      }
      resolve();
    });
  });
};

const regenerateSession = (req: Request): Promise<void> => {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error: unknown) => {
      if (error) {
        reject(new AppError('Error establishing session', 500));
        return;
      }
      resolve();
    });
  });
};

const saveSession = (req: Request): Promise<void> => {
  return new Promise((resolve, reject) => {
    req.session.save((error: unknown) => {
      if (error) {
        reject(new AppError('Error establishing session', 500));
        return;
      }
      resolve();
    });
  });
};

router.post(
  '/register',
  authLimiter,
  validateRequest({ body: registerSchema }),
  asyncHandler(async (req: Request, res: Response<RegisterSuccessResponse | MessageResponse>) => {
    const { username, password } = req.body as RegisterRequestBody;

    const registrationSetting = await db.query<{ setting_value: string }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'",
    );
    const isRegistrationEnabled =
      registrationSetting.rows.length === 0 || registrationSetting.rows[0].setting_value === 'true';

    if (!isRegistrationEnabled) {
      res.status(403).json({ message: 'Registration is currently disabled.' });
      return;
    }

    // DB-08/AUTH-006: usernames are unique case-insensitively (unique index
    // on LOWER(username), migration 0018) so lookalike accounts ("Alice" vs
    // "alice") cannot exist. Pre-check case-insensitively and treat an
    // INSERT race on the index the same way.
    const existingUser = await db.query<Pick<UserRow, 'id'>>(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [username],
    );
    if (existingUser.rows.length > 0) {
      res.status(400).json({ message: 'Username already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, SECURITY_CONFIG.SALT_ROUNDS);
    try {
      const result = await db.query<Pick<UserPublicProfileDTO, 'id' | 'username'>>(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, hashedPassword],
      );

      res.status(201).json({
        message: 'User registered successfully',
        user: result.rows[0],
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(400).json({ message: 'Username already exists' });
        return;
      }
      throw error;
    }
  }),
);

// PUBLIC facing endpoint to check registration status
router.get(
  '/settings/registration',
  asyncHandler(async (_req: Request, res: Response<RegistrationStatusResponse>) => {
    const result = await db.query<{ setting_value: string }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'",
    );

    if (result.rows.length === 0) {
      res.json({ enabled: true });
      return;
    }

    res.json({ enabled: result.rows[0].setting_value === 'true' });
  }),
);

/**
 * PUBLIC site configuration the frontend needs before it can render:
 * which access mode the site is in, whether self-registration is open,
 * and whether self-service password changes are allowed. Contains nothing
 * sensitive — safe for unauthenticated visitors.
 */
router.get(
  '/site-config',
  asyncHandler(async (_req: Request, res: Response) => {
    const [accessMode, registrationResult, passwordChangeEnabled] = await Promise.all([
      getSiteAccessMode(),
      db.query<{ setting_value: string }>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'",
      ),
      getPasswordChangeEnabled(),
    ]);
    const allowRegistration =
      registrationResult.rows.length === 0 || registrationResult.rows[0].setting_value === 'true';

    res.json({ accessMode, allowRegistration, passwordChangeEnabled });
  }),
);

router.post(
  '/login',
  authLimiter,
  validateRequest({ body: loginSchema }),
  asyncHandler(async (req: Request, res: Response<LoginSuccessResponse | MessageResponse>) => {
    const { username, password } = req.body as LoginRequestBody;

    // Per-account throttle (AUTH-001): IP-keyed limiting alone is defeated by
    // rotating spoofed IPs; after too many failures for one username the
    // account is locked out regardless of source. Checked before the DB hit
    // so a locked account costs (almost) nothing to reject.
    if (isLoginLocked(username)) {
      logger.warn('login blocked', { reason: 'account_lockout', username });
      res.status(429).json({ message: 'Too many failed login attempts. Please try again later.' });
      return;
    }

    const result = await db.query<UserRow & { has_avatar: boolean }>(
      'SELECT *, (avatar_png IS NOT NULL) AS has_avatar FROM users WHERE username = $1',
      [username],
    );
    if (result.rows.length === 0) {
      // Use a single neutral message for both unknown-username and wrong-password
      // failures so the endpoint does not leak which usernames exist.
      logger.warn('login failed', { reason: 'unknown_username', username });
      recordLoginFailure(username);
      res.status(401).json({ message: 'Invalid username or password' });
      return;
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn('login failed', { reason: 'wrong_password', username });
      recordLoginFailure(username);
      res.status(401).json({ message: 'Invalid username or password' });
      return;
    }

    clearLoginFailures(username);

    // Regenerate the session on successful authentication to prevent session
    // fixation: any pre-login session id is discarded and a fresh cookie is issued.
    await regenerateSession(req);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.hasAvatar = user.has_avatar;

    await saveSession(req);

    // Tier + level ride along at login so the frontend can show the user's
    // progression in the navbar dropdown without a second round-trip. A
    // failure here must never fail the login itself.
    let tier: string | undefined;
    let level: number | undefined;
    try {
      ({ tier, level } = await getUserTierAndLevel(user.id));
    } catch (tierError) {
      logger.warn('failed to compute tier at login', { userId: user.id, err: tierError });
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        hasAvatar: user.has_avatar,
        ...(tier !== undefined ? { tier, level } : {}),
      },
    });
  }),
);

router.post('/logout', asyncHandler(async (req: Request, res: Response<MessageResponse>) => {
  await destroySession(req);
  res.json({ message: 'Logout successful' });
}));

/**
 * AUTH-004: self-service password change for any authenticated role.
 *
 * Verifies the current password against the stored bcrypt hash, updates it,
 * and signs out every OTHER session of the user (the current session is kept
 * so this device stays signed in). The endpoint's own bcrypt compare is a
 * natural cost throttle and is additionally covered by the general API
 * limiter; no separate limiter is applied (note in the audit trail).
 */
router.put(
  '/profile/password',
  requireAuth,
  validateRequest({ body: changePasswordSchema }),
  asyncHandler(async (req: Request, res: Response<MessageResponse>) => {
    // Self-service gate: when password_change_enabled is off, only admins
    // keep self-service (the admin reset route is not gated by this).
    const passwordChangeEnabled = await getPasswordChangeEnabled();
    if (!passwordChangeEnabled && req.user!.role !== 'admin') {
      res.status(403).json({ message: 'Password changes are currently managed by administrators.' });
      return;
    }

    const { currentPassword, newPassword } = req.body as ChangePasswordRequestBody;

    const result = await changeOwnPassword(
      req.user!.id,
      currentPassword,
      newPassword,
      req.sessionID,
    );
    if (result.kind === 'not_found') {
      throw new AppError('Account not found.', 404);
    }
    if (result.kind === 'wrong_password') {
      throw new AppError('Current password is incorrect', 401);
    }

    logger.info('password changed', { userId: req.user!.id });
    res.json({ message: 'Password changed successfully. Other sessions have been signed out.' });
  }),
);

router.get('/me', asyncHandler(async (req: Request, res: Response<MeResponse>) => {
  if (req.user) {
    // This endpoint runs once per app bootstrap (session hydration), not per
    // request, so the tier aggregation is bounded. req.user itself stays
    // aggregation-free (attachRequestUser never touches progression tables).
    let tier: string | undefined;
    let level: number | undefined;
    try {
      ({ tier, level } = await getUserTierAndLevel(req.user.id));
    } catch (tierError) {
      logger.warn('failed to compute tier for /me', { userId: req.user.id, err: tierError });
    }

    res.json({
      isAuthenticated: true,
      user: { ...req.user, ...(tier !== undefined ? { tier, level } : {}) },
    });
    return;
  }

  res.json({ isAuthenticated: false });
}));

export default router;
