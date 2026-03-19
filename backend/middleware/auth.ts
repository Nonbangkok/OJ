import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to check if user is authenticated
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Authentication required' });
  }
};

/**
 * Middleware to check if user is staff or admin
 */
export const requireStaffOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.session.role === 'admin' || req.session.role === 'staff') {
    next();
  } else {
    res.status(403).json({ message: 'Staff or Admin access required' });
  }
};

/**
 * Middleware to check if user is an admin
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};