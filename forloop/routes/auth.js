/*
 * Landing page, sign in, sign up, sign out, plus the guards other routers use:
 *   requireAuth        - must be signed in
 *   requireRole        - must have one of the given roles
 *   requireStudentInfo - students must finish /student-info first
 *   requireNonMember   - only students with no organization yet
 *   lockNonMembers     - only students with at least one organization
 */
const express = require('express');
const db = require('../conn').promise();
const {
  hashPassword,
  verifyPassword,
  initials,
  wrap,
  text,
  cleanEmail,
  EMAIL_PATTERN,
  ROLES,
} = require('../utils');

const router = express.Router();
const DEMO = 'maya@north.edu (student) · admin@codecraft.edu (adviser) — password "password"';
const ORG_COLORS = ['yellow', 'teal', 'lime', 'lilac'];

/* ---------- Helpers ---------- */

/* How many organizations the user belongs to (0 = non-member). */
async function countOrgs(uid) {
  const [[row]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid]);
  return Number(row.c);
}

/* Has this student filled in /student-info? */
async function hasStudentInfo(uid) {
  const [[row]] = await db.query('SELECT profile_complete FROM users WHERE id = ?', [uid]);
  return Boolean(row && Number(row.profile_complete));
}

/* The page a user lands on after signing in. */
async function homeFor(user) {
  if (user.role === 'adviser') {
    return '/admin';
  }
  if (!(await hasStudentInfo(user.id))) {
    return '/student-info';
  }
  return (await countOrgs(user.id)) > 0 ? '/student' : '/nonmember';
}

/* What we keep in the session about a user row. */
function sessionUser(row) {
  return { id: row.id, name: row.full_name, role: row.role, org_id: row.org_id };
}

/* ---------- Guards ---------- */

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

/* Wrong role goes to their own portal; anonymous goes to sign-in. */
function requireRole(...roles) {
  return wrap(async (req, res, next) => {
    const user = req.session.user;
    if (!user) {
      return res.redirect('/login');
    }
    if (!roles.includes(user.role)) {
      return res.redirect(await homeFor(user));
    }
    next();
  });
}

async function checkNonMember(req, res, next) {
  if ((await countOrgs(req.session.user.id)) > 0) {
    return res.redirect('/student');
  }
  next();
}

async function checkMember(req, res, next) {
  if ((await countOrgs(req.session.user.id)) === 0) {
    return res.redirect('/nonmember');
  }
  next();
}

async function checkStudentInfo(req, res, next) {
  const user = req.session.user;
  if (user && user.role === 'student' && !(await hasStudentInfo(user.id))) {
    return res.redirect('/student-info');
  }
  next();
}

const requireNonMember = wrap(checkNonMember);
const lockNonMembers = wrap(checkMember);
const requireStudentInfo = wrap(checkStudentInfo);

/* ---------- Pages ---------- */

function renderAuth(res, mode, error, values = {}, role = 'student') {
  res.status(error ? 400 : 200).render('shared/auth', { mode, error, values, role, demo: DEMO });
}

/* Signed-in visitors skip the public pages and go straight to their portal. */
async function redirectSignedInUser(req, res, next) {
  if (req.session.user) {
    return res.redirect(await homeFor(req.session.user));
  }
  next();
}

function showLanding(req, res) {
  res.render('shared/index');
}

function showLogin(req, res) {
  renderAuth(res, 'login', null);
}

/* ?role=adviser pre-selects the adviser tab */
function showRegister(req, res) {
  const role = ROLES.includes(req.query.role) ? req.query.role : 'student';
  renderAuth(res, 'register', null, {}, role);
}

/* Old per-role URLs still work */
function redirectOldLoginUrl(req, res) {
  res.redirect(req.query.mode === 'register' ? '/register' : '/login');
}

/* ---------- Sign in ---------- */

async function login(req, res) {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');

  const [[row]] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  const passwordOk = row && (await verifyPassword(password, row.password_hash));
  if (!passwordOk) {
    return renderAuth(res, 'login', 'Incorrect email or password. Check them and try again.', {
      email,
    });
  }

  req.session.user = sessionUser(row);
  res.redirect(await homeFor(req.session.user));
}

/* ---------- Sign up ---------- */

/* Returns an error message, or null when the form is fine. */
async function validateRegistration({ role, name, email, password, orgName }) {
  if (!name || !email) {
    return 'Enter your full name and university email.';
  }
  if (!EMAIL_PATTERN.test(email)) {
    return 'Enter a valid email address.';
  }
  if (password.length < 6) {
    return 'Use a password with at least 6 characters.';
  }
  if (role === 'adviser' && !orgName) {
    return 'Enter your organization name.';
  }

  const [taken] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (taken.length) {
    return 'An account with that email already exists. Sign in instead.';
  }
  return null;
}

/* Advisers get a starter organization of their own. */
async function createOrganization(name) {
  const color = ORG_COLORS[Math.floor(Math.random() * ORG_COLORS.length)];
  const [result] = await db.query(
    'INSERT INTO organizations (name, description, category, tags, color, logo_text, logo_style) VALUES (?,?,?,?,?,?,?)',
    [
      name,
      'Tell students what your community is about.',
      'Technology',
      'Community',
      color,
      initials(name).slice(0, 2),
      'dark',
    ],
  );
  return result.insertId;
}

async function register(req, res) {
  const form = {
    role: ROLES.includes(req.body.role) ? req.body.role : 'student',
    name: text(req.body.full_name),
    email: cleanEmail(req.body.email),
    password: String(req.body.password || ''),
    orgName: text(req.body.org_name),
  };

  const error = await validateRegistration(form);
  if (error) {
    const values = { full_name: form.name, email: form.email, org_name: form.orgName };
    return renderAuth(res, 'register', error, values, form.role);
  }

  /* Only advisers create an organization; a student's org_name is ignored. */
  const orgId = form.role === 'adviser' ? await createOrganization(form.orgName) : null;
  const [result] = await db.query(
    'INSERT INTO users (full_name, email, password_hash, role, org_id) VALUES (?,?,?,?,?)',
    [form.name, form.email, await hashPassword(form.password), form.role, orgId],
  );

  req.session.user = { id: result.insertId, name: form.name, role: form.role, org_id: orgId };
  res.redirect(await homeFor(req.session.user));
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

/* ---------- Routes ---------- */
router.get('/', wrap(redirectSignedInUser), showLanding);
router.get('/login', wrap(redirectSignedInUser), showLogin);
router.get('/register', wrap(redirectSignedInUser), showRegister);
router.get('/login/:role', redirectOldLoginUrl);
router.post('/auth/login', wrap(login));
router.post('/auth/register', wrap(register));
router.get('/logout', logout);

module.exports = router;
module.exports.countOrgs = countOrgs;
module.exports.homeFor = homeFor;
module.exports.sessionUser = sessionUser;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
module.exports.requireNonMember = requireNonMember;
module.exports.lockNonMembers = lockNonMembers;
module.exports.requireStudentInfo = requireStudentInfo;
