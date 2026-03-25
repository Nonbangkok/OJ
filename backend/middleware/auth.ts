import { Request, Response, NextFunction } from 'express';
import { USER_ROLES } from '../constants';

/**
 * Middleware to check if user is authenticated
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.id || req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Authentication required' });
  }
};

/**
 * Middleware to check if user is staff or admin
 */
export const requireStaffOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role ?? req.session.role;
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
  if ((req.user?.role ?? req.session.role) === USER_ROLES.ADMIN) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};
