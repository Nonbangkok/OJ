import { NextFunction, Request, Response } from 'express';

/**
 * Maps session data into `req.user` so downstream layers can consume
 * one typed auth context instead of reading multiple session fields.
 */
export const attachRequestUser = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.session.userId && req.session.username && req.session.role) {
        req.user = {
            id: req.session.userId,
            username: req.session.username,
            role: req.session.role as 'user' | 'staff' | 'admin',
        };
    } else {
        req.user = undefined;
    }

    next();
};
