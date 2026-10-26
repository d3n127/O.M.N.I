/*
 * Pages every signed-in user has: student information, profile, settings, password.
 * The router is mounted at "/", so every guard is scoped to PAGES below.
 */
const express = require('express');
const db = require('../conn');
const {
  flash,
  text,
  cleanEmail,
  EMAIL_PATTERN,
  DEPT_NAMES,
  hashPassword,
  verifyPassword,
} = require('../utils');
const { countOrgs, requireAuth, requireStudentInfo } = require('./auth');

const router = express.Router();
const PAGES = ['/student-info', '/profile', '/settings', '/profile/password'];

const YEAR_LEVELS = [1, 2, 3, 4];
const PROGRAMS = [
  'BS Computer Science',
  'BS Information Systems',
  'BS Information Technology',
  'BS Software Engineering',
  'BS Data Science',
  'BS Electronics Engineering',
  'BS Nursing',
  'BS Business Administration',
];

const STUDENT_ID_PATTERN = /^[A-Za-z0-9-]{4,24}$/;
const CONTACT_PATTERN = /^[0-9+()\-\s]{7,20}$/;

/* ---------- Guards ---------- */

/* Choose the page layout: the admin, student or non-member shell (a view folder, not a role). */
function choosePortalLayout(req, res, next) {
  const user = req.session.user;
  res.locals.portal = 'nonmember';

  if (user.role === 'adviser') {
    return db.query('SELECT * FROM organizations WHERE id = ?', [user.org_id], (err, orgs) => {
      if (err) {
        return next(err);
      }
      if (!orgs.length) {
        return req.session.destroy(() => res.redirect('/'));
      }
      res.locals.org = orgs[0];
      res.locals.portal = 'admin';
      next();
    });
  }

  countOrgs(user.id, (err, count) => {
    if (err) {
      return next(err);
    }
    if (count > 0) {
      res.locals.portal = 'student';
    }
    next();
  });
}

router.use(PAGES, requireAuth);
router.use(PAGES, choosePortalLayout);

/* ---------- Student information form ---------- */

/* Read and clean the student fields from a submitted form. */
function readStudentInfo(body) {
  return {
    student_id: text(body.student_id, 24),
    program: text(body.program, 100),
    year_level: text(body.year_level),
    contact: text(body.contact, 30),
    college: text(body.college, 100),
    bio: text(body.bio, 300),
    hobbies: text(body.hobbies, 300),
  };
}

/*
 * Checks student ID (pattern and not used by another account), program, contact and college.
 * done(err, message) where message is the first error, or null. Bio and year are checked by callers.
 */
function checkStudentInfo(info, uid, done) {
  if (!STUDENT_ID_PATTERN.test(info.student_id)) {
    return done(null, 'Enter your student ID (4-24 letters, numbers or dashes).');
  }

  db.query(
    'SELECT id FROM users WHERE student_id = ? AND id <> ?',
    [info.student_id, uid],
    (err, taken) => {
      if (err) {
        return done(err);
      }
      if (taken.length) {
        return done(null, 'That student ID is already registered to another account.');
      }
      if (!PROGRAMS.includes(info.program)) {
        return done(null, 'Choose your program from the list.');
      }
      if (!CONTACT_PATTERN.test(info.contact)) {
        return done(null, 'Enter a valid contact number (7-20 digits).');
      }
      if (!DEPT_NAMES.includes(info.college)) {
        return done(null, 'Choose your college/faculty from the list.');
      }
      done(null, null);
    },
  );
}

/* Students only; advisers go back to their portal. Returns true when it redirected. */
function redirectNonStudent(req, res) {
  const user = req.session.user;
  if (user.role === 'student') {
    return false;
  }
  res.redirect(user.role === 'adviser' ? '/admin' : '/student');
  return true;
}

function renderStudentInfo(res, values, error = null) {
  res.status(error ? 400 : 200).render('shared/student-info', {
    title: 'Student information',
    active: '',
    values,
    error,
    programs: PROGRAMS,
    departments: DEPT_NAMES,
  });
}

function showStudentInfo(req, res, next) {
  if (redirectNonStudent(req, res)) {
    return;
  }

  db.query(
    'SELECT student_id, program, year_level, contact, college, bio, hobbies FROM users WHERE id = ?',
    [req.session.user.id],
    (err, rows) => {
      if (err) {
        return next(err);
      }
      renderStudentInfo(res, rows[0] || {});
    },
  );
}

function saveStudentInfo(req, res, next) {
  if (redirectNonStudent(req, res)) {
    return;
  }
  const uid = req.session.user.id;
  const info = readStudentInfo(req.body);
  const year = Number(info.year_level);

  checkStudentInfo(info, uid, (err, error) => {
    if (err) {
      return next(err);
    }
    if (!error && !YEAR_LEVELS.includes(year)) {
      error = 'Choose your year level.';
    }
    if (!error && !info.bio) {
      error = 'Write a short bio about yourself.';
    }
    if (error) {
      return renderStudentInfo(res, info, error);
    }

    db.query(
      'UPDATE users SET student_id = ?, program = ?, year_level = ?, contact = ?, college = ?, bio = ?, hobbies = ?, profile_complete = 1 WHERE id = ?',
      [info.student_id, info.program, year, info.contact, info.college, info.bio, info.hobbies, uid],
      (err) => {
        if (err) {
          return next(err);
        }
        flash(req, 'Student information saved.');

        countOrgs(uid, (err, count) => {
          if (err) {
            return next(err);
          }
          res.redirect(count > 0 ? '/student' : '/nonmember');
        });
      },
    );
  });
}

/* ---------- Profile and settings pages ---------- */

/* The adviser's organization name; null for students. done(err, name | null) */
function loadOrgName(user, done) {
  if (!user.org_id) {
    return done(null, null);
  }
  db.query('SELECT name FROM organizations WHERE id = ?', [user.org_id], (err, rows) => {
    if (err) {
      return done(err);
    }
    done(null, rows.length ? rows[0].name : null);
  });
}

/* A student's memberships; empty for advisers. done(err, orgs) */
function loadMemberships(user, done) {
  if (user.role !== 'student') {
    return done(null, []);
  }
  db.query(
    'SELECT o.name, m.role_title, m.joined_at FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.joined_at',
    [user.id],
    done,
  );
}

/* The user's account row, organization name and memberships. done(err, { u, orgName, orgs } | null) */
function loadAccount(uid, done) {
  db.query(
    'SELECT id, full_name, email, role, student_id, program, year_level, contact, college, bio, hobbies, org_id, created_at FROM users WHERE id = ?',
    [uid],
    (err, rows) => {
      if (err) {
        return done(err);
      }
      if (!rows.length) {
        return done(null, null);
      }
      const u = rows[0];

      loadOrgName(u, (err, orgName) => {
        if (err) {
          return done(err);
        }
        loadMemberships(u, (err, orgs) => {
          if (err) {
            return done(err);
          }
          done(null, { u, orgName, orgs });
        });
      });
    },
  );
}

/* Render a page that needs the account data; a deleted account is signed out. */
function renderAccountPage(req, res, next, view, page) {
  loadAccount(req.session.user.id, (err, account) => {
    if (err) {
      return next(err);
    }
    if (!account) {
      return req.session.destroy(() => res.redirect('/'));
    }
    res.render(view, { ...page, ...account });
  });
}

function showProfile(req, res, next) {
  renderAccountPage(req, res, next, 'shared/profile', { title: 'Profile', active: '' });
}

function showSettings(req, res, next) {
  renderAccountPage(req, res, next, 'shared/settings', {
    title: 'Settings',
    active: 'settings',
    programs: PROGRAMS,
    departments: DEPT_NAMES,
  });
}

/* ---------- Edit profile ---------- */

/* Settings-page errors show as a flash message and redirect back. */
function backToSettings(req, res, message) {
  flash(req, message, 'err');
  res.redirect('/settings');
}

/* Save the new name and email (and, for students, the student fields). */
function saveProfileChanges(req, res, next, name, email) {
  const { id: uid, role } = req.session.user;

  function finish(err) {
    if (err) {
      return next(err);
    }
    req.session.user.name = name;
    flash(req, 'Profile updated.');
    res.redirect('/settings');
  }

  if (role !== 'student') {
    return db.query(
      'UPDATE users SET full_name = ?, email = ? WHERE id = ?',
      [name, email, uid],
      finish,
    );
  }

  const info = readStudentInfo(req.body);
  checkStudentInfo(info, uid, (err, error) => {
    if (err) {
      return next(err);
    }
    if (error) {
      return backToSettings(req, res, error);
    }
    /* An unrecognised year level falls back to 1 */
    const year = YEAR_LEVELS.includes(Number(info.year_level)) ? Number(info.year_level) : 1;

    db.query(
      'UPDATE users SET full_name = ?, email = ?, student_id = ?, program = ?, year_level = ?, contact = ?, college = ?, bio = ?, hobbies = ? WHERE id = ?',
      [
        name,
        email,
        info.student_id,
        info.program,
        year,
        info.contact,
        info.college,
        info.bio,
        info.hobbies,
        uid,
      ],
      finish,
    );
  });
}

function saveProfile(req, res, next) {
  const name = text(req.body.full_name);
  const email = cleanEmail(req.body.email);

  if (!name) {
    return backToSettings(req, res, 'Enter your full name.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    return backToSettings(req, res, 'Enter a valid email address.');
  }

  db.query(
    'SELECT id FROM users WHERE email = ? AND id <> ?',
    [email, req.session.user.id],
    (err, taken) => {
      if (err) {
        return next(err);
      }
      if (taken.length) {
        return backToSettings(req, res, 'Another account already uses that email.');
      }
      saveProfileChanges(req, res, next, name, email);
    },
  );
}

/* ---------- Change password ---------- */

function changePassword(req, res, next) {
  const uid = req.session.user.id;
  const current = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');

  if (!newPassword) {
    return backToSettings(req, res, 'Enter a new password.');
  }
  if (newPassword.length < 6) {
    return backToSettings(req, res, 'Use a new password with at least 6 characters.');
  }
  if (newPassword !== confirm) {
    return backToSettings(req, res, 'New password and confirmation do not match.');
  }

  db.query('SELECT password_hash FROM users WHERE id = ?', [uid], (err, rows) => {
    if (err) {
      return next(err);
    }

    verifyPassword(current, rows[0].password_hash, (err, currentOk) => {
      if (err) {
        return next(err);
      }
      if (!currentOk) {
        return backToSettings(req, res, 'Your current password is incorrect.');
      }

      hashPassword(newPassword, (err, hash) => {
        if (err) {
          return next(err);
        }
        db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, uid], (err) => {
          if (err) {
            return next(err);
          }
          flash(req, 'Password changed.');
          res.redirect('/settings');
        });
      });
    });
  });
}

/* ---------- Routes ---------- */
router.get('/student-info', showStudentInfo);
router.post('/student-info', saveStudentInfo);

/* Everything below needs complete student info (but /student-info itself must not). */
router.use(['/profile', '/settings', '/profile/password'], requireStudentInfo);

router.get('/profile', showProfile);
router.get('/settings', showSettings);
router.post('/profile', saveProfile);
router.post('/profile/password', changePassword);

module.exports = router;
