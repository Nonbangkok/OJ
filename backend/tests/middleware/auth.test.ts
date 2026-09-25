import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireStaffOrAdmin, requireAdmin } from '../../middleware/auth';

/**
 * The guards read ONLY req.user (the typed context populated by
 * attachRequestUser after session revalidation) — raw session fields must
 * not grant access (AUTH-010).
 */
const userReq = (user: { id: number; username: string; role: 'user' | 'staff' | 'admin'; hasAvatar: boolean } | undefined): Partial<Request> => ({
    user,
});

describe('Auth Middleware', () => {
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    describe('requireAuth', () => {
        it('calls next when req.user is present', () => {
            requireAuth(userReq({ id: 1, username: 'u', role: 'user', hasAvatar: false }) as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 401 when req.user is undefined', () => {
            requireAuth(userReq(undefined) as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('does NOT authorize from raw session fields alone (AUTH-010)', () => {
            const req = userReq(undefined) as Request;
            (req as { session?: unknown }).session = { userId: 1, role: 'admin' };

            requireAuth(req, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireStaffOrAdmin', () => {
        it('calls next when req.user.role is admin', () => {
            requireStaffOrAdmin(userReq({ id: 1, username: 'u', role: 'admin', hasAvatar: false }) as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('calls next when req.user.role is staff', () => {
            requireStaffOrAdmin(userReq({ id: 1, username: 'u', role: 'staff', hasAvatar: false }) as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 403 when req.user.role is user', () => {
            requireStaffOrAdmin(userReq({ id: 1, username: 'u', role: 'user', hasAvatar: false }) as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Staff or Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when req.user is undefined', () => {
            requireStaffOrAdmin(userReq(undefined) as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Staff or Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('does NOT authorize from a stale session role (AUTH-010)', () => {
            const req = userReq({ id: 1, username: 'u', role: 'user', hasAvatar: false }) as Request;
            (req as { session?: unknown }).session = { userId: 1, role: 'admin' };

            requireStaffOrAdmin(req, res as Response, next);

            // req.user wins: the demoted role from the users row is authoritative.
            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireAdmin', () => {
        it('calls next when req.user.role is admin', () => {
            requireAdmin(userReq({ id: 1, username: 'u', role: 'admin', hasAvatar: false }) as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 403 when req.user.role is staff', () => {
            requireAdmin(userReq({ id: 1, username: 'u', role: 'staff', hasAvatar: false }) as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when req.user.role is user', () => {
            requireAdmin(userReq({ id: 1, username: 'u', role: 'user', hasAvatar: false }) as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when req.user is undefined even with a session role', () => {
            const req = userReq(undefined) as Request;
            (req as { session?: unknown }).session = { userId: 1, role: 'admin' };

            requireAdmin(req, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
