/*
 * Landing page, sign in, sign up, sign out, plus the guards other routers use:
 *   requireAuth        - must be signed in
 *   requireRole        - must have one of the given roles
 *   requireStudentInfo - students must finish /student-info first
 *   requireNonMember   - only students with no organization yet
 *   lockNonMembers     - only students with at least one organization
 *
 * Functions that read the database finish by calling done(err, result).
 */
const express = require('express');
const db = require('../conn');
const {
  hashPassword,
  verifyPassword,
  initials,
  text,
  cleanEmail,
  EMAIL_PATTERN,
  ROLES,
  ORG_COLORS,
} = require('../utils');

const router = express.Router();
const DEMO = 'maya@north.edu (student) · admin@codecraft.edu (adviser) — password "password"';

/* ---------- Helpers ---------- */

/* How many organizations the user belongs to (0 = non-member). done(err, number) */
function countOrgs(uid, done) {
  db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid], (err, rows) => {
    if (err) {
      return done(err);
    }
    done(null, Number(rows[0].c));
  });
}

/* Has this student filled in /student-info? done(err, true | false) */
function hasStudentInfo(uid, done) {
  db.query('SELECT profile_complete FROM users WHERE id = ?', [uid], (err, rows) => {
    if (err) {
      return done(err);
    }
    done(null, rows.length > 0 && Number(rows[0].profile_complete) === 1);
  });
}

/* The page a user lands on after signing in. done(err, url) */
function homeFor(user, done) {
  if (user.role === 'adviser') {
    return done(null, '/admin');
  }

  hasStudentInfo(user.id, (err, complete) => {
    if (err) {
      return done(err);
    }
    if (!complete) {
      return done(null, '/student-info');
    }
    countOrgs(user.id, (err, count) => {
      if (err) {
        return done(err);
      }
      done(null, count > 0 ? '/student' : '/nonmember');
    });
  });
}

/* Send the user to their own portal. */
function redirectHome(user, res, next) {
  homeFor(user, (err, url) => {
    if (err) {
      return next(err);
    }
    res.redirect(url);
  });
}

/* What we keep in the session about a user row. */
function sessionUser(row) {
  return { id: row.id, name: row.full_name, role: row.role, org_id: row.org_id, avatar: row.avatar || null };
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
  return (req, res, next) => {
    const user = req.session.user;
    if (!user) {
      return res.redirect('/login');
    }
    if (!roles.includes(user.role)) {
      return redirectHome(user, res, next);
    }
    next();
  };
}

/* Students who already have an organization belong on /student. */
function requireNonMember(req, res, next) {
  countOrgs(req.session.user.id, (err, count) => {
    if (err) {
      return next(err);
    }
    if (count > 0) {
      return res.redirect('/student');
    }
    next();
  });
}

/* Students with no organization yet belong on /nonmember. */
function lockNonMembers(req, res, next) {
  countOrgs(req.session.user.id, (err, count) => {
    if (err) {
      return next(err);
    }
    if (count === 0) {
      return res.redirect('/nonmember');
    }
    next();
  });
}

/* Students must complete /student-info before using a portal. Advisers pass. */
function requireStudentInfo(req, res, next) {
  const user = req.session.user;
  if (!user || user.role !== 'student') {
    return next();
  }

  hasStudentInfo(user.id, (err, complete) => {
    if (err) {
      return next(err);
    }
    if (!complete) {
      return res.redirect('/student-info');
    }
    next();
  });
}

/* ---------- Pages ---------- */

function renderAuth(res, mode, error, values = {}, role = 'student') {
  res.status(error ? 400 : 200).render('shared/auth', { mode, error, values, role, demo: DEMO });
}

/* Signed-in visitors skip the public pages and go straight to their portal. */
function redirectSignedInUser(req, res, next) {
  if (req.session.user) {
    return redirectHome(req.session.user, res, next);
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

function login(req, res, next) {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');

  function showWrongPassword() {
    renderAuth(res, 'login', 'Incorrect email or password. Check them and try again.', { email });
  }

  db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email], (err, rows) => {
    if (err) {
      return next(err);
    }
    if (!rows.length) {
      return showWrongPassword();
    }

    const user = rows[0];
    verifyPassword(password, user.password_hash, (err, passwordOk) => {
      if (err) {
        return next(err);
      }
      if (!passwordOk) {
        return showWrongPassword();
      }
      req.session.user = sessionUser(user);
      redirectHome(req.session.user, res, next);
    });
  });
}

/* ---------- Sign up ---------- */

/* done(err, message) where message is an error text, or null when the form is fine. */
function validateRegistration({ role, name, email, password, orgName }, done) {
  if (!name || !email) {
    return done(null, 'Enter your full name and university email.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    return done(null, 'Enter a valid email address.');
  }
  if (password.length < 6) {
    return done(null, 'Use a password with at least 6 characters.');
  }
  if (role === 'adviser' && !orgName) {
    return done(null, 'Enter your organization name.');
  }

  db.query('SELECT id FROM users WHERE email = ?', [email], (err, taken) => {
    if (err) {
      return done(err);
    }
    if (taken.length) {
      return done(null, 'An account with that email already exists. Sign in instead.');
    }
    done(null, null);
  });
}

/* Advisers get a starter organization of their own. done(err, newOrgId) */
function createOrganization(name, done) {
  const color = ORG_COLORS[Math.floor(Math.random() * ORG_COLORS.length)];
  db.query(
    'INSERT INTO organizations (name, description, category, tags, color, logo_img, logo_style) VALUES (?,?,?,?,?,?,?)',
    [
      name,
      'Tell students what your community is about.',
      'Technology',
      'Community',
      color,
      initials(name).slice(0, 2),
      'dark',
    ],
    (err, result) => {
      if (err) {
        return done(err);
      }
      done(null, result.insertId);
    },
  );
}

/* Only advisers create an organization; a student's org_name is ignored. done(err, orgId | null) */
function createOrganizationIfAdviser(form, done) {
  if (form.role !== 'adviser') {
    return done(null, null);
  }
  createOrganization(form.orgName, done);
}

function register(req, res, next) {
  const form = {
    role: ROLES.includes(req.body.role) ? req.body.role : 'student',
    name: text(req.body.full_name),
    email: cleanEmail(req.body.email),
    password: String(req.body.password || ''),
    orgName: text(req.body.org_name),
  };

  validateRegistration(form, (err, message) => {
    if (err) {
      return next(err);
    }
    if (message) {
      const values = { full_name: form.name, email: form.email, org_name: form.orgName };
      return renderAuth(res, 'register', message, values, form.role);
    }

    createOrganizationIfAdviser(form, (err, orgId) => {
      if (err) {
        return next(err);
      }
      hashPassword(form.password, (err, hash) => {
        if (err) {
          return next(err);
        }
        db.query(
          'INSERT INTO users (full_name, email, password_hash, role, org_id) VALUES (?,?,?,?,?)',
          [form.name, form.email, hash, form.role, orgId],
          (err, result) => {
            if (err) {
              return next(err);
            }
            req.session.user = {
              id: result.insertId,
              name: form.name,
              role: form.role,
              org_id: orgId,
            };
            redirectHome(req.session.user, res, next);
          },
        );
      });
    });
  });
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

/* ---------- Routes ---------- */
router.get('/', redirectSignedInUser, showLanding);
router.get('/login', redirectSignedInUser, showLogin);
router.get('/register', redirectSignedInUser, showRegister);
router.get('/login/:role', redirectOldLoginUrl);
router.post('/auth/login', login);
router.post('/auth/register', register);
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
