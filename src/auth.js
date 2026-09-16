function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Acceso restringido',
        message: 'Tu cuenta no tiene permiso para entrar a esta sección.'
      });
    }
    return next();
  };
}

function redirectByRole(user) {
  if (user.role === 'superadmin') return '/super';
  if (user.role === 'game_admin') return '/admin';
  return '/player';
}

module.exports = { requireLogin, requireRole, redirectByRole };
