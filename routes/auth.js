const express = require('express');
const db = require('../config').promise();
const { hashPassword, verifyPassword, initials } = require('../utils');
const { wrap, hasOrg } = require('../middleware');

const router = express.Router();
const ROLES = ['student', 'admin'];
const DEMO = { student: '', admin: '' };
const COLORS = ['yellow', 'teal', 'lime', 'lilac'];

// membership-aware landing (FR-NONMEMBER-6): officers -> /admin, students with 0 orgs -> /nonmember
async function home(u) {
  if (u.role === 'admin') return '/admin';
  return (await hasOrg(u.id)) > 0 ? '/student' : '/nonmember';
}

function renderAuth(res, role, mode, error, values = {}) {
  res.status(error ? 400 : 200).render('shared/auth', { role, mode, error, values, demo: DEMO[role] });
}

router.get('/', wrap(async (req, res) => {
  if (req.session.user) return res.redirect(await home(req.session.user));
  res.render('shared/index');
}));

router.get('/login/:role', (req, res) => {
  const { role } = req.params;
  if (!ROLES.includes(role)) return res.redirect('/');
  renderAuth(res, role, req.query.mode === 'register' ? 'register' : 'login', null, {});
});

router.post('/auth/login', wrap(async (req, res) => {
  const role = ROLES.includes(req.body.role) ? req.body.role : 'student';
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND role = ?', [email, role]);
  if (!rows.length || !verifyPassword(String(req.body.password || ''), rows[0].password_hash)) {
    return renderAuth(res, role, 'login', 'Incorrect email or password. Check them and try again.', { email });
  }
  const u = rows[0];
  req.session.user = { id: u.id, name: u.full_name, role: u.role, org_id: u.org_id };
  res.redirect(await home(req.session.user));
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
    [name, email, hashPassword(password), role, orgId]);
  req.session.user = { id: u.insertId, name, role, org_id: orgId };
  res.redirect(await home(req.session.user));
}));

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
