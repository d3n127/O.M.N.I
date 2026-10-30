const express = require('express');
const db = require('../../conn').promise();
const { hashPassword, verifyPassword, initials } = require('../../utils');
const { wrap, homeFor } = require('../../middleware');

const router = express.Router();

/* ONE sign-in for every kind of account — organization owner, org member or plain student.
   The form never asks who you are: the address alone identifies the account (email is
   globally unique) and, once the password checks out, homeFor() (RBAC) decides the portal:
      admin                       -> /admin
      student, info not finished  -> /student-info first
      student with >= 1 org       -> /student   (member)
      student with 0 orgs         -> /nonmember */
const DEMO = 'maya@north.edu (student) · admin@codecraft.edu (organization owner) — password for both: password';

/* what the register form may declare; the login form declares nothing */
const TYPES = ['student', 'owner'];
const roleFor = (type) => (type === 'owner' ? 'admin' : 'student');
const COLORS = ['yellow', 'teal', 'lime', 'lilac'];

function renderAuth(res, mode, type, error, values = {}) {
  res.status(error ? 400 : 200).render('shared/auth', { mode, type, error, values, demo: DEMO });
}

router.get('/', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  res.render('shared/index');
}));

/* the single login/register page: ?mode=register opens sign-up,
   ?type=owner preselects "I run an organization" on it */
router.get('/login', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  const mode = req.query.mode === 'register' ? 'register' : 'login';
  const type = TYPES.includes(req.query.type) ? req.query.type : 'student';
  renderAuth(res, mode, type, null, {});
}));

/* legacy role-scoped URLs (/login/student, /login/admin) — there is one login now, so
   forward them and keep whatever the link was trying to do (register / preselect type) */
router.get('/login/:role', (req, res) => {
  const q = new URLSearchParams();
  if (req.query.mode === 'register') q.set('mode', 'register');
  q.set('type', req.params.role === 'admin' ? 'owner' : 'student');
  res.redirect('/login?' + q.toString());
});

router.post('/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  /* no role field: one lookup, then RBAC routes the session */
  const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  if (!rows.length) {
    return renderAuth(res, 'login', 'student',
      'There is no account with that email. Create one first.', { email });
  }
  if (!(await verifyPassword(password, rows[0].password_hash))) {
    return renderAuth(res, 'login', 'student',
      'Incorrect email or password. Check them and try again.', { email });
  }
  const u = rows[0];
  req.session.user = { id: u.id, name: u.full_name, role: u.role, org_id: u.org_id };
  res.redirect(await homeFor(req.session.user));
}));

router.post('/auth/register', wrap(async (req, res) => {
  const type = TYPES.includes(req.body.account_type) ? req.body.account_type : 'student';
  const role = roleFor(type);
  const name = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const orgName = String(req.body.org_name || '').trim();
  const values = { full_name: name, email, org_name: orgName, account_type: type };

  if (!name || !email) return renderAuth(res, 'register', type, 'Enter your full name and university email.', values);
  if (!/^\S+@\S+\.\S+$/.test(email)) return renderAuth(res, 'register', type, 'Enter a valid email address.', values);
  if (password.length < 6) return renderAuth(res, 'register', type, 'Use a password with at least 6 characters.', values);
  if (type === 'owner' && !orgName) return renderAuth(res, 'register', type, 'Enter your organization name.', values);

  /* globally unique: one address = one account, whichever kind it is */
  const [dupe] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (dupe.length) return renderAuth(res, 'register', type,
    'An account with that email already exists. Sign in instead.', values);

  let orgId = null;
  if (type === 'owner') {
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
