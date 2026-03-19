import express, { Request, Response, Router } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import * as db from '../db';
import { USER_VALIDATION, SECURITY_CONFIG } from '../constants';

const router: Router = express.Router();

router.post('/register', [
  body('username').isLength({ min: USER_VALIDATION.MIN_USERNAME_LENGTH }).trim().escape(),
  body('password').isLength({ min: USER_VALIDATION.MIN_PASSWORD_LENGTH })
], async (req: Request, res: Response) => {
  try {
    // Check if registration is enabled
    const regSettings = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'"
    );
    const isRegistrationEnabled = regSettings.rows.length === 0 || regSettings.rows[0].setting_value === 'true';

    if (!isRegistrationEnabled) {
      return res.status(403).json({ message: 'Registration is currently disabled.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // Check if username already exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    // Hash password
    const saltRounds = SECURITY_CONFIG.SALT_ROUNDS;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const result = await db.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUBLIC facing endpoint to check registration status
router.get('/settings/registration', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'"
    );

    if (result.rows.length === 0) {
      return res.json({ enabled: true });
    }
    res.json({ enabled: result.rows[0].setting_value === 'true' });
  } catch (error) {
    // On error, default to disabled for security.
    console.error('Error fetching public registration setting:', error);
    res.json({ enabled: false });
  }
});

router.post('/login', [
  body('username').trim().escape(),
  body('password').notEmpty()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password } = req.body;

  try {
    // Find user by username
    const result = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = result.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Wrong Password' });
    }

    // Create session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role; // Use role instead of isAdmin

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role, // Send role to frontend
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err: any) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    res.json({ message: 'Logout successful' });
  });
});

router.get('/me', (req: Request, res: Response) => {
  if (req.session.userId) {
    res.json({
      isAuthenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role, // Use role
      }
    });
  } else {
    res.json({ isAuthenticated: false });
  }
});

export default router;