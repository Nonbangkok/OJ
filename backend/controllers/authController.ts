import express, { Request, Response, Router } from 'express';
import bcrypt from 'bcrypt';
import * as db from '../db';
import { SECURITY_CONFIG } from '../constants';
import { UserPublicProfileDTO, UserRow } from '../types/models';
import {
  LoginRequestBody,
  LoginSuccessResponse,
  MeResponse,
  MessageResponse,
  RegisterRequestBody,
  RegisterSuccessResponse,
  RegistrationStatusResponse,
} from '../types/api';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import { authLimiter } from '../middleware/rateLimit';
import { loginSchema, registerSchema } from '../schemas/requestSchemas';

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

    const existingUser = await db.query<Pick<UserRow, 'id'>>('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      res.status(400).json({ message: 'Username already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, SECURITY_CONFIG.SALT_ROUNDS);
    const result = await db.query<Pick<UserPublicProfileDTO, 'id' | 'username'>>(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword],
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0],
    });
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

router.post(
  '/login',
  authLimiter,
  validateRequest({ body: loginSchema }),
  asyncHandler(async (req: Request, res: Response<LoginSuccessResponse | MessageResponse>) => {
    const { username, password } = req.body as LoginRequestBody;

    const result = await db.query<UserRow>('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      res.status(401).json({ message: 'User not found' });
      return;
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      res.status(401).json({ message: 'Wrong Password' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  }),
);

router.post('/logout', asyncHandler(async (req: Request, res: Response<MessageResponse>) => {
  await destroySession(req);
  res.json({ message: 'Logout successful' });
}));

router.get('/me', (req: Request, res: Response<MeResponse>) => {
  if (req.user) {
    res.json({
      isAuthenticated: true,
      user: req.user,
    });
    return;
  }

  res.json({ isAuthenticated: false });
});

export default router;
