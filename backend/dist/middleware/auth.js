"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.requireStaffOrAdmin = exports.requireAuth = void 0;
/**
 * Middleware to check if user is authenticated
 */
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    }
    else {
        res.status(401).json({ message: 'Authentication required' });
    }
};
exports.requireAuth = requireAuth;
/**
 * Middleware to check if user is staff or admin
 */
const requireStaffOrAdmin = (req, res, next) => {
    if (req.session.role === 'admin' || req.session.role === 'staff') {
        next();
    }
    else {
        res.status(403).json({ message: 'Staff or Admin access required' });
    }
};
exports.requireStaffOrAdmin = requireStaffOrAdmin;
/**
 * Middleware to check if user is an admin
 */
const requireAdmin = (req, res, next) => {
    if (req.session.role === 'admin') {
        next();
    }
    else {
        res.status(403).json({ message: 'Admin access required' });
    }
};
exports.requireAdmin = requireAdmin;
//# sourceMappingURL=auth.js.map