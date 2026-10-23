const express = require('express');
const db = require('../conn').promise();
const { wrap, flash, hasOrg, requireAuth, requireStudentInfo } = require('../middleware');
const { hashPassword, verifyPassword, DEPT_NAMES } = require('../utils');

const router = express.Router();

/* These four pages are what this router owns. The guards MUST be path-scoped: the router is
   mounted at "/", so an unscoped router.use() here also runs for /admin, /student and
   /notifications/read — stealing those requests from requireRole() and sending anonymous
   visitors to the landing page instead of their portal's login screen. */
const PAGES = ['/student-info', '/profile', '/settings', '/profile/password'];

/* any logged-in user (student, nonmember or admin) may manage their profile */
router.use(PAGES, requireAuth);

/* pick the portal shell the page renders inside (admin sidebar / student topbar / nonmember topbar) */
router.use(PAGES, wrap(async (req, res, next) => {
  const u = req.session.user;
  res.locals.portal = 'nonmember';
  if (u.role === 'admin') {
    const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [u.org_id]);
    if (!org) return req.session.destroy(() => res.redirect('/'));
    res.locals.org = org;
    res.locals.portal = 'admin';
  } else if ((await hasOrg(u.id)) > 0) {
    res.locals.portal = 'student';
  }
  next();
}));

/* ---------- required student information (submitted right after registering) ---------- */
const YEAR_LEVELS = [1, 2, 3, 4];
const PROGRAMS = ['BS Computer Science', 'BS Information Systems', 'BS Information Technology', 'BS Software Engineering', 'BS Data Science', 'BS Electronics Engineering', 'BS Nursing', 'BS Business Administration'];

function studentInfoValues(body) {
  return {
    student_id: String(body.student_id || '').trim().slice(0, 24),
    program: String(body.program || '').trim().slice(0, 100),
    year_level: String(body.year_level || '').trim(),
    contact: String(body.contact || '').trim().slice(0, 30),
    college: String(body.college || '').trim().slice(0, 100),
    bio: String(body.bio || '').trim().slice(0, 300),
    hobbies: String(body.hobbies || '').trim().slice(0, 300)
  };
}

/* only students see this page; officers are sent back to their portal */
function studentOnly(req, res) {
  const u = req.session.user;
  if (u.role === 'student') return false;
  res.redirect(u.role === 'admin' ? '/admin' : '/student');
  return true;
}

router.get('/student-info', wrap(async (req, res) => {
  if (studentOnly(req, res)) return;
  const [[row]] = await db.query(
    'SELECT student_id, program, year_level, contact, college, bio, hobbies FROM users WHERE id = ?',
    [req.session.user.id]);
  res.render('shared/student-info', { title: 'Student information', active: '', values: row || {}, error: null, programs: PROGRAMS, departments: DEPT_NAMES });
}));

router.post('/student-info', wrap(async (req, res) => {
  if (studentOnly(req, res)) return;
  const uid = req.session.user.id;
  const v = studentInfoValues(req.body);
  const fail = (msg) => res.status(400).render('shared/student-info', { title: 'Student information', active: '', values: v, error: msg, programs: PROGRAMS, departments: DEPT_NAMES });

  if (!v.student_id || !/^[A-Za-z0-9-]{4,24}$/.test(v.student_id)) return fail('Enter your student ID (4-24 letters, numbers or dashes).');
  const [dupe] = await db.query('SELECT id FROM users WHERE student_id = ? AND id <> ?', [v.student_id, uid]);
  if (dupe.length) return fail('That student ID is already registered to another account.');
  if (!PROGRAMS.includes(v.program)) return fail('Choose your program from the list.');
  const year = Number(v.year_level);
  if (!YEAR_LEVELS.includes(year)) return fail('Choose your year level.');
  if (!v.contact || !/^[0-9+()\-\s]{7,20}$/.test(v.contact)) return fail('Enter a valid contact number (7-20 digits).');
  if (!DEPT_NAMES.includes(v.college)) return fail('Choose your college/faculty from the list.');
  if (!v.bio) return fail('Write a short bio about yourself.');

  await db.query(
    'UPDATE users SET student_id = ?, program = ?, year_level = ?, contact = ?, college = ?, bio = ?, hobbies = ?, profile_complete = 1 WHERE id = ?',
    [v.student_id, v.program, year, v.contact, v.college, v.bio, v.hobbies, uid]);
  flash(req, 'Student information saved.');
  res.redirect((await hasOrg(uid)) > 0 ? '/student' : '/nonmember');
}));

/* everything below requires the student information to be complete (officers pass through).
   /student-info is deliberately excluded — it is the gate itself, so gating it would loop. */
router.use(['/profile', '/settings', '/profile/password'], requireStudentInfo);

/* shared data loader for the view + settings pages */
async function loadAccount(uid) {
  const [[u]] = await db.query(
    'SELECT id, full_name, email, role, student_id, program, year_level, contact, college, bio, hobbies, org_id, created_at FROM users WHERE id = ?', [uid]);
  if (!u) return null;
  let orgName = null;
  if (u.org_id) {
    const [[o]] = await db.query('SELECT name FROM organizations WHERE id = ?', [u.org_id]);
    orgName = o ? o.name : null;
  }
  /* the student's organizations (name + role title) for the profile */
  let orgs = [];
  if (u.role === 'student') {
    [orgs] = await db.query(
      'SELECT o.name, m.role_title, m.joined_at FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.joined_at',
      [uid]);
  }
  return { u, orgName, orgs };
}

/* ---------- /profile: read-only profile view ---------- */
router.get('/profile', wrap(async (req, res) => {
  const acc = await loadAccount(req.session.user.id);
  if (!acc) return req.session.destroy(() => res.redirect('/'));
  res.render('shared/profile', {
    title: 'Profile',
    active: '',
    ...acc
  });
}));

/* ---------- /settings: edit profile, password, appearance ---------- */
router.get('/settings', wrap(async (req, res) => {
  const acc = await loadAccount(req.session.user.id);
  if (!acc) return req.session.destroy(() => res.redirect('/'));
  res.render('shared/settings', {
    title: 'Settings',
    active: 'settings',
    ...acc, programs: PROGRAMS, departments: DEPT_NAMES
  });
}));

/* edit profile details */
router.post('/profile', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const role = req.session.user.role;
  const name = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const back = '/settings';

  if (!name) { flash(req, 'Enter your full name.', 'err'); return res.redirect(back); }
  if (!/^\S+@\S+\.\S+$/.test(email)) { flash(req, 'Enter a valid email address.', 'err'); return res.redirect(back); }
  const [dupe] = await db.query('SELECT id FROM users WHERE email = ? AND role = ? AND id <> ?', [email, role, uid]);
  if (dupe.length) { flash(req, 'Another account already uses that email.', 'err'); return res.redirect(back); }

  if (role === 'student') {
    const v = studentInfoValues(req.body);
    if (!v.student_id || !/^[A-Za-z0-9-]{4,24}$/.test(v.student_id)) { flash(req, 'Enter a valid student ID (4-24 letters, numbers or dashes).', 'err'); return res.redirect(back); }
    const [dupeSid] = await db.query('SELECT id FROM users WHERE student_id = ? AND id <> ?', [v.student_id, uid]);
    if (dupeSid.length) { flash(req, 'That student ID is already registered to another account.', 'err'); return res.redirect(back); }
    if (!PROGRAMS.includes(v.program)) { flash(req, 'Choose your program from the list.', 'err'); return res.redirect(back); }
    const year = YEAR_LEVELS.includes(Number(v.year_level)) ? Number(v.year_level) : 1;
    if (!v.contact || !/^[0-9+()\-\s]{7,20}$/.test(v.contact)) { flash(req, 'Enter a valid contact number (7-20 digits).', 'err'); return res.redirect(back); }
    if (!DEPT_NAMES.includes(v.college)) { flash(req, 'Choose your college/faculty from the list.', 'err'); return res.redirect(back); }
    await db.query(
      'UPDATE users SET full_name = ?, email = ?, student_id = ?, program = ?, year_level = ?, contact = ?, college = ?, bio = ?, hobbies = ? WHERE id = ?',
      [name, email, v.student_id, v.program, year, v.contact, v.college, v.bio, v.hobbies, uid]);
  } else {
    await db.query('UPDATE users SET full_name = ?, email = ? WHERE id = ?', [name, email, uid]);
  }
  req.session.user.name = name;
  flash(req, 'Profile updated.');
  res.redirect(back);
}));

/* change password */
router.post('/profile/password', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const cur = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');
  const back = '/settings';

  if (!next) { flash(req, 'Enter a new password.', 'err'); return res.redirect(back); }
  if (next.length < 6) { flash(req, 'Use a new password with at least 6 characters.', 'err'); return res.redirect(back); }
  if (next !== confirm) { flash(req, 'New password and confirmation do not match.', 'err'); return res.redirect(back); }

  const [[u]] = await db.query('SELECT password_hash FROM users WHERE id = ?', [uid]);
  if (!(await verifyPassword(cur, u.password_hash))) {
    flash(req, 'Your current password is incorrect.', 'err');
    return res.redirect(back);
  }
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), uid]);
  flash(req, 'Password changed.');
  res.redirect(back);
}));

module.exports = router;
