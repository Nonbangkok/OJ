// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Authentication required' });
  }
};

const requireAuth_pdf = (req, res, next) => {
  console.log("--------------------------------");
  console.log(req.session);
  console.log(req.session.userId);
  console.log("--------------------------------");
  next();
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
  // requireAuth_pdf,
  requireStaffOrAdmin
}; 