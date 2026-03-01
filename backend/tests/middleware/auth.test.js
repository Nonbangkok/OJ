const { requireAuth, requireStaffOrAdmin, requireAdmin } = require('../../middleware/auth');

describe('Auth Middleware', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
        req = { session: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    describe('requireAuth', () => {
        it('calls next when userId exists in session', () => {
            req.session.userId = 1;

            requireAuth(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 401 when userId is not in session', () => {
            requireAuth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireStaffOrAdmin', () => {
        it('calls next when role is admin', () => {
            req.session.role = 'admin';

            requireStaffOrAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('calls next when role is staff', () => {
            req.session.role = 'staff';

            requireStaffOrAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 403 when role is not admin or staff', () => {
            req.session.role = 'user';

            requireStaffOrAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Staff or Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when role is undefined', () => {
            requireStaffOrAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireAdmin', () => {
        it('calls next when role is admin', () => {
            req.session.role = 'admin';

            requireAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 403 when role is staff', () => {
            req.session.role = 'staff';

            requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when role is user', () => {
            req.session.role = 'user';

            requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
