/*
 * Pages every signed-in user has: student information, profile, settings, password.
 * The router is mounted at "/", so every guard is scoped to PAGES below.
 */
const express = require('express');
const db = require('../conn').promise();
const {
  wrap,
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

router.use(PAGES, requireAuth);

/* Choose the page layout: the admin, student or non-member shell (a view folder, not a role). */
async function choosePortalLayout(req, res, next) {
  const user = req.session.user;
  res.locals.portal = 'nonmember';

  if (user.role === 'adviser') {
    const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [user.org_id]);
    if (!org) {
      return req.session.destroy(() => res.redirect('/'));
    }
    res.locals.org = org;
    res.locals.portal = 'admin';
  } else if ((await countOrgs(user.id)) > 0) {
    res.locals.portal = 'student';
  }
  next();
}

router.use(PAGES, wrap(choosePortalLayout));

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

/* Returns an error message for the first bad field, or null. Bio and year are checked by callers. */
async function checkStudentInfo(info, uid) {
  if (!STUDENT_ID_PATTERN.test(info.student_id)) {
    return 'Enter your student ID (4-24 letters, numbers or dashes).';
  }
  const [taken] = await db.query('SELECT id FROM users WHERE student_id = ? AND id <> ?', [
    info.student_id,
    uid,
  ]);
  if (taken.length) {
    return 'That student ID is already registered to another account.';
  }
  if (!PROGRAMS.includes(info.program)) {
    return 'Choose your program from the list.';
  }
  if (!CONTACT_PATTERN.test(info.contact)) {
    return 'Enter a valid contact number (7-20 digits).';
  }
  if (!DEPT_NAMES.includes(info.college)) {
    return 'Choose your college/faculty from the list.';
  }
  return null;
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

async function showStudentInfo(req, res) {
  if (redirectNonStudent(req, res)) {
    return;
  }
  const [[row]] = await db.query(
    'SELECT student_id, program, year_level, contact, college, bio, hobbies FROM users WHERE id = ?',
    [req.session.user.id],
  );
  renderStudentInfo(res, row || {});
}

async function saveStudentInfo(req, res) {
  if (redirectNonStudent(req, res)) {
    return;
  }
  const uid = req.session.user.id;
  const info = readStudentInfo(req.body);

  let error = await checkStudentInfo(info, uid);
  const year = Number(info.year_level);
  if (!error && !YEAR_LEVELS.includes(year)) {
    error = 'Choose your year level.';
  }
  if (!error && !info.bio) {
    error = 'Write a short bio about yourself.';
  }
  if (error) {
    return renderStudentInfo(res, info, error);
  }

  await db.query(
    'UPDATE users SET student_id = ?, program = ?, year_level = ?, contact = ?, college = ?, bio = ?, hobbies = ?, profile_complete = 1 WHERE id = ?',
    [info.student_id, info.program, year, info.contact, info.college, info.bio, info.hobbies, uid],
  );
  flash(req, 'Student information saved.');
  res.redirect((await countOrgs(uid)) > 0 ? '/student' : '/nonmember');
}

/* ---------- Profile and settings pages ---------- */

/* The user's account row, their organization name (advisers) and memberships (students). */
async function loadAccount(uid) {
  const [[u]] = await db.query(
    'SELECT id, full_name, email, role, student_id, program, year_level, contact, college, bio, hobbies, org_id, created_at FROM users WHERE id = ?',
    [uid],
  );
  if (!u) {
    return null;
  }

  let orgName = null;
  if (u.org_id) {
    const [[org]] = await db.query('SELECT name FROM organizations WHERE id = ?', [u.org_id]);
    orgName = org ? org.name : null;
  }

  let orgs = [];
  if (u.role === 'student') {
    [orgs] = await db.query(
      'SELECT o.name, m.role_title, m.joined_at FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.joined_at',
      [uid],
    );
  }
  return { u, orgName, orgs };
}

/* Render a page that needs the account data; a deleted account is signed out. */
async function renderAccountPage(req, res, view, page) {
  const account = await loadAccount(req.session.user.id);
  if (!account) {
    return req.session.destroy(() => res.redirect('/'));
  }
  res.render(view, { ...page, ...account });
}

async function showProfile(req, res) {
  await renderAccountPage(req, res, 'shared/profile', { title: 'Profile', active: '' });
}

async function showSettings(req, res) {
  await renderAccountPage(req, res, 'shared/settings', {
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

async function saveProfile(req, res) {
  const { id: uid, role } = req.session.user;
  const name = text(req.body.full_name);
  const email = cleanEmail(req.body.email);

  if (!name) {
    return backToSettings(req, res, 'Enter your full name.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    return backToSettings(req, res, 'Enter a valid email address.');
  }
  const [taken] = await db.query('SELECT id FROM users WHERE email = ? AND id <> ?', [email, uid]);
  if (taken.length) {
    return backToSettings(req, res, 'Another account already uses that email.');
  }

  if (role === 'student') {
    const info = readStudentInfo(req.body);
    const error = await checkStudentInfo(info, uid);
    if (error) {
      return backToSettings(req, res, error);
    }
    /* An unrecognised year level falls back to 1 */
    const year = YEAR_LEVELS.includes(Number(info.year_level)) ? Number(info.year_level) : 1;

    await db.query(
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
    );
  } else {
    await db.query('UPDATE users SET full_name = ?, email = ? WHERE id = ?', [name, email, uid]);
  }

  req.session.user.name = name;
  flash(req, 'Profile updated.');
  res.redirect('/settings');
}

/* ---------- Change password ---------- */

async function changePassword(req, res) {
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

  const [[row]] = await db.query('SELECT password_hash FROM users WHERE id = ?', [uid]);
  if (!(await verifyPassword(current, row.password_hash))) {
    return backToSettings(req, res, 'Your current password is incorrect.');
  }

  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [
    await hashPassword(newPassword),
    uid,
  ]);
  flash(req, 'Password changed.');
  res.redirect('/settings');
}

/* ---------- Routes ---------- */
router.get('/student-info', wrap(showStudentInfo));
router.post('/student-info', wrap(saveStudentInfo));

/* Everything below needs complete student info (but /student-info itself must not). */
router.use(['/profile', '/settings', '/profile/password'], requireStudentInfo);

router.get('/profile', wrap(showProfile));
router.get('/settings', wrap(showSettings));
router.post('/profile', wrap(saveProfile));
router.post('/profile/password', wrap(changePassword));

module.exports = router;
