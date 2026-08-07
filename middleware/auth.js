function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(roles) {
  return function (req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (!allowed.includes(req.session.user.role)) {
      return res.status(403).render('pages/error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        error: {}
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
