import 'express-serve-static-core';
import { UserPublicProfileDTO } from '../models';

declare module 'express-serve-static-core' {
    interface Request {
        user?: UserPublicProfileDTO;
    }
}
