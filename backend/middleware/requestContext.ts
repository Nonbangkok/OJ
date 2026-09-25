import { NextFunction, Request, Response } from 'express';
import * as db from '../db';
import { UserRole } from '../types/models';
import { logger } from '../utils/logger';

/** Columns refreshed from the users row on every authenticated request. */
interface SessionUserRow {
    id: number;
    username: string;
    role: UserRole;
    has_avatar: boolean;
}

/**
 * Revalidates the session's login-time user snapshot against the users
 * table (AUTH-002/003, ADMIN-001).
 *
 * Sessions used to carry the username/role captured at login for their whole
 * 24h lifetime, so deleted users kept access (some endpoints then 500'd on
 * FK), demoted staff/admins kept elevated privileges, and renamed users kept
 * stale usernames. This middleware runs once per request after the session
 * store hydrates the session and re-syncs the snapshot from the live row —
 * one indexed primary-key lookup:
 *
 *   - user row exists  -> session username/role/hasAvatar are refreshed, so
 *     renames and role changes take effect on the very next request;
 *   - user row is gone -> the session's auth fields are stripped and the
 *     request proceeds as unauthenticated (no more ban evasion or FK 500s).
 *
 * Database errors fail closed (next(error) -> 500): a database we cannot
 * read is a database we cannot authorize against.
 *
 * Guest sessions (no userId) skip the lookup entirely, so anonymous browsing
 * costs no extra query.
 */
export const revalidateSessionUser = async (
    req: Request,
    _res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const session = req.session;
        if (!session?.userId) {
            next();
            return;
        }

        const result = await db.query<SessionUserRow>(
            'SELECT id, username, role, (avatar_png IS NOT NULL) AS has_avatar FROM users WHERE id = $1',
            [session.userId],
        );

        if (result.rows.length === 0) {
            // User deleted (admin ban or cleanup): the session must no longer
            // authenticate anything. Strip the auth fields; attachRequestUser
            // below then maps this to an unauthenticated request context.
            logger.warn('session user no longer exists, invalidating session', {
                userId: session.userId,
            });
            delete session.userId;
            delete session.username;
            delete session.role;
            delete session.hasAvatar;
            next();
            return;
        }

        // Re-sync the login-time snapshot. Assigning identical values leaves
        // the session unmodified, so express-session does not rewrite the
        // store row on steady-state requests.
        const user = result.rows[0];
        session.username = user.username;
        session.role = user.role;
        session.hasAvatar = user.has_avatar;

        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Maps session data into `req.user` so downstream layers can consume
 * one typed auth context instead of reading multiple session fields.
 *
 * Mounted after revalidateSessionUser in the real app, so the data mapped
 * here is at most one request stale. The username/role fallbacks keep this
 * mapper usable standalone (unit tests, legacy sessions created before a
 * field existed) and default to least privilege.
 */
export const attachRequestUser = (req: Request, _res: Response, next: NextFunction): void => {
    const session = req.session;

    if (session?.userId) {
        req.user = {
            id: session.userId,
            username: session.username ?? '',
            role: (session.role ?? 'user') as 'user' | 'staff' | 'admin',
            hasAvatar: session.hasAvatar === true,
        };
    } else {
        req.user = undefined;
    }

    next();
};
