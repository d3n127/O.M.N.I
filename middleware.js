// Lets async route handlers throw errors safely into Express.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const requireRole = (role) => (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login/' + role);
  if (u.role !== role) return res.redirect(u.role === 'admin' ? '/admin' : '/student');
  next();
};

const flash = (req, msg, type = 'ok') => { req.session.flash = { msg, type }; };

module.exports = { wrap, requireRole, flash };
