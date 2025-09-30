// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.status(401).json({ message: 'Authentication required' });
  }
};

// Middleware to check if user is staff or admin
const requireStaffOrAdmin = (req, res, next) => {
  if (req.session.role === 'admin' || req.session.role === 'staff') {
    next();
  } else {
    res.status(403).json({ message: 'Staff or Admin access required' });
  }
};

module.exports = {
  requireAuth,
  requireStaffOrAdmin
}; 