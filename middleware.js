const db = require('./conn').promise();

// Lets async route handlers throw errors safely into Express.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const requireRole = (role) => (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login/' + role);
  if (u.role !== role) return res.redirect(u.role === 'admin' ? '/admin' : '/student');
  next();
};

const flash = (req, msg, type = 'ok') => { req.session.flash = { msg, type }; };

/* membership gate (spec-nonmember §4.1): a "non-member" is 0 rows in memberships */
const hasOrg = async (uid) => {
  const [[r]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid]);
  return Number(r.c);
};

// attached inside /nonmember after requireRole('student'): a member (>=1 org) belongs on /student
const requireNonMember = wrap(async (req, res, next) => {
  const n = await hasOrg(req.session.user.id);
  if (n > 0) return res.redirect('/student');
  next();
});

// attached inside /student after requireRole('student'): 0 orgs -> the limited portal
const lockNonMembers = wrap(async (req, res, next) => {
  const n = await hasOrg(req.session.user.id);
  if (n === 0) return res.redirect('/nonmember');
  next();
});

module.exports = { wrap, requireRole, flash, hasOrg, requireNonMember, lockNonMembers };
