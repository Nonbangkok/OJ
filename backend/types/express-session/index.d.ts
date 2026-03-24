import 'express-session';
import { UserRole } from '../models';

declare module 'express-session' {
    interface SessionData {
        userId: number;
        username: string;
        role: UserRole;
    }
}
