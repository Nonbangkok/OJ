import 'express-session';
import { UserRole } from '../models';

declare module 'express-session' {
    interface SessionData {
        // Auth snapshot captured at login and re-synced from the users row on
        // every request by revalidateSessionUser. Optional because a deleted
        // user's session has these fields stripped mid-request.
        userId?: number;
        username?: string;
        role?: UserRole;
        hasAvatar?: boolean;
    }
}
