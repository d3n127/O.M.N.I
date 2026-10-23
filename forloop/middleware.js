const db = require('./conn').promise();

// Lets async route handlers throw errors safely into Express.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* every role that exists in this app — imported by routes so the list lives in one place */
const ROLES = ['student', 'admin'];

const flash = (req, msg, type = 'ok') => { req.session.flash = { msg, type }; };

/* membership gate (spec-nonmember §4.1): a "non-member" is 0 rows in memberships */
const hasOrg = async (uid) => {
  const [[r]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid]);
  return Number(r.c);
};

/* where a user belongs — used after sign-in AND to bounce someone out of a portal
   they don't belong in (incomplete student info -> /student-info first) */
const homeFor = async (u) => {
  if (u.role === 'admin') return '/admin';
  const [[r]] = await db.query('SELECT profile_complete FROM users WHERE id = ?', [u.id]);
  if (!r || !Number(r.profile_complete)) return '/student-info';
  return (await hasOrg(u.id)) > 0 ? '/student' : '/nonmember';
};

/* ROLE SOURCE OF TRUTH: the session cookie only carries the user id; the role is re-read
   from the database on every request. So (a) an officer demoting a member via
   POST /members/:id/role takes effect on that member's very next request instead of
   after their session expires, and (b) a deleted account is logged out immediately. */
const loadUser = wrap(async (req, res, next) => {
  const s = req.session.user;
  if (!s) return next();
  const [[u]] = await db.query('SELECT id, full_name, role, org_id FROM users WHERE id = ?', [s.id]);
  if (!u) return req.session.destroy(() => next());
  req.session.user = { id: u.id, name: u.full_name, role: u.role, org_id: u.org_id };
  next();
});

/* logged in? anonymous visitors go back to the landing page to pick a portal */
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/');
  next();
};

/* RBAC gate: requireRole('student') or requireRole('student', 'admin').
   anonymous  -> the login screen for the first listed role
   wrong role -> that user's own home portal (never a dead end) */
const requireRole = (...roles) => wrap(async (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login/' + roles[0]);
  if (!roles.includes(u.role)) return res.redirect(await homeFor(u));
  next();
});

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

/* required student information gate: a student who never finished /student-info can't use the portals */
const requireStudentInfo = wrap(async (req, res, next) => {
  const u = req.session.user;
  if (!u || u.role !== 'student') return next();
  const [[r]] = await db.query('SELECT profile_complete FROM users WHERE id = ?', [u.id]);
  if (!r || !Number(r.profile_complete)) return res.redirect('/student-info');
  next();
});

module.exports = { wrap, ROLES, flash, hasOrg, homeFor, loadUser, requireAuth, requireRole, requireNonMember, lockNonMembers, requireStudentInfo };
