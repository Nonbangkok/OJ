import { Request, Response, NextFunction } from 'express';
import { USER_ROLES } from '../constants';

/**
 * Auth guards read ONLY `req.user` — the typed context populated by
 * attachRequestUser (which runs after revalidateSessionUser). Falling back to
 * raw session fields here would let requests whose user row failed
 * revalidation (deleted user) slip past the guard, since the session store
 * still carries the stale login-time fields until they are rewritten.
 */

/**
 * Middleware to check if user is authenticated
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.id) {
    next();
  } else {
    res.status(401).json({ message: 'Authentication required' });
  }
};

/**
 * Middleware to check if user is staff or admin
 */
export const requireStaffOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (role === USER_ROLES.ADMIN || role === USER_ROLES.STAFF) {
    next();
  } else {
    res.status(403).json({ message: 'Staff or Admin access required' });
  }
};

/**
 * Middleware to check if user is an admin
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role === USER_ROLES.ADMIN) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};
