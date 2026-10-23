const express = require('express');
const db = require('../conn').promise();
const { hashPassword, verifyPassword, initials } = require('../utils');
const { wrap, homeFor, ROLES } = require('../middleware');

const router = express.Router();
const DEMO = { student: 'maya@north.edu / password', admin: 'admin@codecraft.edu / password (UIPC)' };
const COLORS = ['yellow', 'teal', 'lime', 'lilac'];

const label = (role) => (role === 'admin' ? 'organization' : 'student');

function renderAuth(res, role, mode, error, values = {}) {
  res.status(error ? 400 : 200).render('shared/auth', { role, mode, error, values, demo: DEMO[role] });
}

router.get('/', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  res.render('shared/index');
}));

router.get('/login/:role', wrap(async (req, res) => {
  const { role } = req.params;
  if (!ROLES.includes(role)) return res.redirect('/');
  // already signed in (any role) — no login form, go to your own portal
  if (req.session.user) return res.redirect(await homeFor(req.session.user));
  renderAuth(res, role, req.query.mode === 'register' ? 'register' : 'login', null, {});
}));

router.post('/auth/login', wrap(async (req, res) => {
  const role = ROLES.includes(req.body.role) ? req.body.role : 'student';
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND role = ?', [email, role]);
  if (!rows.length) {
    // RBAC feedback: the email may exist, just not on this portal
    const [other] = await db.query('SELECT role FROM users WHERE email = ? LIMIT 1', [email]);
    if (other.length) return renderAuth(res, role, 'login',
      `That email is registered as a ${label(other[0].role)} account — sign in on the ${label(other[0].role)} portal instead.`, { email });
    return renderAuth(res, role, 'login',
      `There is no ${label(role)} account with that email. Create one first.`, { email });
  }
  if (!(await verifyPassword(password, rows[0].password_hash))) {
    return renderAuth(res, role, 'login', 'Incorrect email or password. Check them and try again.', { email });
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

  if (!name || !email) return renderAuth(res, role, 'register', 'Enter your full name and university email.', values);
  if (!/^\S+@\S+\.\S+$/.test(email)) return renderAuth(res, role, 'register', 'Enter a valid email address.', values);
  if (password.length < 6) return renderAuth(res, role, 'register', 'Use a password with at least 6 characters.', values);
  if (role === 'admin' && !orgName) return renderAuth(res, role, 'register', 'Enter your organization name.', values);

  const [dupe] = await db.query('SELECT id FROM users WHERE email = ? AND role = ?', [email, role]);
  if (dupe.length) return renderAuth(res, role, 'register', 'An account with that email already exists. Sign in instead.', values);

  let orgId = null;
  if (role === 'admin') {
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
