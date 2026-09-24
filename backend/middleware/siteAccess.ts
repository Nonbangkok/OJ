import { Request, Response, NextFunction } from 'express';
import { getSiteAccessMode } from '../services/siteSettingsService';
import { AppError } from './errorHandler';

/**
 * Site-level access gate for public-browsing content routes
 * (problems, contests, scoreboard...).
 *
 * PUBLIC mode: the request passes through — the route's own visibility /
 * permission logic (hidden problems, per-contest access, ...) applies as
 * before.
 *
 * PRIVATE mode: unauthenticated requests are rejected with 401 before the
 * handler runs, so protected data never leaves the server. Authenticated
 * users continue through the route's existing permission checks.
 *
 * Deliberately NOT applied to: auth endpoints (login/register must stay
 * reachable), the public site-config endpoint, health checks, static
 * assets, and routes that already carry requireAuth (this gate would be
 * redundant there).
 */
export const requirePublicAccess = async (
    req: Request,
    _res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const mode = await getSiteAccessMode();
        if (mode === 'private' && !(req.user?.id || req.session.userId)) {
            throw new AppError('Authentication required', 401);
        }
        next();
    } catch (error) {
        next(error);
    }
};
