import { NextFunction, Request, Response } from 'express';

/**
 * Maps session data into `req.user` so downstream layers can consume
 * one typed auth context instead of reading multiple session fields.
 */
export const attachRequestUser = (req: Request, _res: Response, next: NextFunction): void => {
    const session = req.session;

    if (session?.userId && session.username && session.role) {
        req.user = {
            id: session.userId,
            username: session.username,
            role: session.role as 'user' | 'staff' | 'admin',
        };
    } else {
        req.user = undefined;
    }

    next();
};
