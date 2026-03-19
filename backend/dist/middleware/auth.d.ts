import { Request, Response, NextFunction } from 'express';
/**
 * Middleware to check if user is authenticated
 */
export declare const requireAuth: (req: Request, res: Response, next: NextFunction) => void;
/**
 * Middleware to check if user is staff or admin
 */
export declare const requireStaffOrAdmin: (req: Request, res: Response, next: NextFunction) => void;
/**
 * Middleware to check if user is an admin
 */
export declare const requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
