import { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler';

/** Block only regular users explicitly locked by an administrator. */
export const requireSubmissionsUnlocked = (
    req: Request,
    _res: Response,
    next: NextFunction,
): void => {
    if (req.user?.role === 'user' && req.user.submissionsLocked === true) {
        next(new AppError('Your account is locked. You cannot submit or join contests while the lock is active.', 403));
        return;
    }
    next();
};
