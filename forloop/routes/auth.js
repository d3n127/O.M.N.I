const express = require('express');
const db = require('../conn').promise();
const { hashPassword, verifyPassword, initials, wrap, ROLES } = require('../utils');

const router = express.Router();
const DEMO = 'maya@north.edu (student) · admin@codecraft.edu (adviser) — password "password"';
const COLORS = ['yellow', 'teal', 'lime', 'lilac'];

/* ============================================================================
   SESSION & RBAC GUARDS  (these lived in middleware.js — they are grouped here
   because they are all about "who is this session and which portal may they
   enter". Every other route file imports what it needs from this module.)
   ========================================================================== */

/* membership gate: a "non-member" is 0 rows in memberships */
const hasOrg = async (uid) => {
  const [[r]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid]);
  return Number(r.c);
};

/* where a user belongs — used after sign-in AND to bounce someone out of a
   portal they don't belong in (incomplete student info -> /student-info first).
   This is where role-based routing happens: advisers always go to /admin. */
const homeFor = async (u) => {
  if (u.role === 'adviser') return '/admin';
  const [[r]] = await db.query('SELECT profile_complete FROM users WHERE id = ?', [u.id]);
  if (!r || !Number(r.profile_complete)) return '/student-info';
  return (await hasOrg(u.id)) > 0 ? '/student' : '/nonmember';
};

/* logged in? anonymous visitors go to the single unified sign-in */
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

/* RBAC gate: requireRole('student') or requireRole('adviser').
   anonymous  -> the unified sign-in screen
   wrong role -> that user's own home portal (never a dead end) */
const requireRole = (...roles) => wrap(async (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (!roles.includes(u.role)) return res.redirect(await homeFor(u));
  next();
});

/* attached inside /nonmember after requireRole('student'): a member (>=1 org) belongs on /student */
const requireNonMember = wrap(async (req, res, next) => {
  const n = await hasOrg(req.session.user.id);
  if (n > 0) return res.redirect('/student');
  next();
});

/* attached inside /student after requireRole('student'): 0 orgs -> the limited portal */
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

/* ============================================================================
   UNIFIED AUTH — one sign-in and one sign-up for every role. The role is never
   chosen on the sign-in form: it comes from the account row itself.
   ========================================================================== */

function renderAuth(res, mode, error, values = {}, role = 'student') {
  res.status(error ? 400 : 200).render('shared/auth', { mode, error, values, role, demo: DEMO });
}

router.get('/', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  res.render('shared/index');
}));

/* one sign-in screen for every role */
router.get('/login', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  renderAuth(res, 'login', null, {});
}));

/* one sign-up screen; ?role=adviser opens it with the adviser option pre-picked */
router.get('/register', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  const role = ROLES.includes(req.query.role) ? req.query.role : 'student';
  renderAuth(res, 'register', null, {}, role);
}));

/* old per-role URLs (/login/student, /login/admin) keep working for bookmarks */
router.get('/login/:role', (req, res) => res.redirect(req.query.mode === 'register' ? '/register' : '/login'));

/* sign in: the email identifies the account, the account row carries the role */
router.post('/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  if (!rows.length || !(await verifyPassword(password, rows[0].password_hash))) {
    return renderAuth(res, 'login', 'Incorrect email or password. Check them and try again.', { email });
  }
  const u = rows[0];
  req.session.user = { id: u.id, name: u.full_name, role: u.role, org_id: u.org_id };
  res.redirect(await homeFor(req.session.user));
}));

router.post('/auth/register', wrap(async (req, res) => {
  const role = ROLES.includes(req.body.role) ? req.body.role : 'student';
  const name = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const orgName = String(req.body.org_name || '').trim();
  const values = { full_name: name, email, org_name: orgName };

  if (!name || !email) return renderAuth(res, 'register', 'Enter your full name and university email.', values, role);
  if (!/^\S+@\S+\.\S+$/.test(email)) return renderAuth(res, 'register', 'Enter a valid email address.', values, role);
  if (password.length < 6) return renderAuth(res, 'register', 'Use a password with at least 6 characters.', values, role);
  /* RBAC: only an adviser creates an organization. A student signing up never
     does — org_name is simply ignored for them, even if posted by hand. */
  if (role === 'adviser' && !orgName) return renderAuth(res, 'register', 'Enter your organization name.', values, role);

  const [dupe] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (dupe.length) return renderAuth(res, 'register', 'An account with that email already exists. Sign in instead.', values, role);

  let orgId = null;
  if (role === 'adviser') {
    const [r] = await db.query(
      'INSERT INTO organizations (name, description, category, tags, color, logo_text, logo_style) VALUES (?,?,?,?,?,?,?)',
      [orgName, 'Tell students what your community is about.', 'Technology', 'Community', COLORS[Math.floor(Math.random() * 4)], initials(orgName).slice(0, 2), 'dark']
    );
    orgId = r.insertId;
  }
  const [u] = await db.query('INSERT INTO users (full_name, email, password_hash, role, org_id) VALUES (?,?,?,?,?)',
    [name, email, await hashPassword(password), role, orgId]);
  req.session.user = { id: u.insertId, name, role, org_id: orgId };
  res.redirect(await homeFor(req.session.user));
}));

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
/* the guards travel with the router so other route files can pull them in by name */
module.exports.hasOrg = hasOrg;
module.exports.homeFor = homeFor;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
module.exports.requireNonMember = requireNonMember;
module.exports.lockNonMembers = lockNonMembers;
module.exports.requireStudentInfo = requireStudentInfo;
