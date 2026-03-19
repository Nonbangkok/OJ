import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireStaffOrAdmin, requireAdmin } from '../../middleware/auth';

describe('Auth Middleware', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        req = { session: {} as any };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    describe('requireAuth', () => {
        it('calls next when userId exists in session', () => {
            if (req.session) req.session.userId = 1;

            requireAuth(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 401 when userId is not in session', () => {
            requireAuth(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireStaffOrAdmin', () => {
        it('calls next when role is admin', () => {
            if (req.session) req.session.role = 'admin';

            requireStaffOrAdmin(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('calls next when role is staff', () => {
            if (req.session) req.session.role = 'staff';

            requireStaffOrAdmin(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 403 when role is not admin or staff', () => {
            if (req.session) req.session.role = 'user';

            requireStaffOrAdmin(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Staff or Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when role is undefined', () => {
            requireStaffOrAdmin(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireAdmin', () => {
        it('calls next when role is admin', () => {
            if (req.session) req.session.role = 'admin';

            requireAdmin(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 403 when role is staff', () => {
            if (req.session) req.session.role = 'staff';

            requireAdmin(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when role is user', () => {
            if (req.session) req.session.role = 'user';

            requireAdmin(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
