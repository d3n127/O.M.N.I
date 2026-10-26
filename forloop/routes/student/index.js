/*
 * Student portal (/student): students who belong to at least one organization.
 * Home, Applications, Bookmarks and My organizations are defined here;
 * Discover, Apply, Events and RSVP come from ../portal.
 */
const express = require('express');
const db = require('../../conn').promise();
const { wrap } = require('../../utils');
const { requireRole, lockNonMembers, requireStudentInfo } = require('../auth');
const { UPCOMING, getOrgs, getUpcomingSummary, addSharedPages } = require('../portal');

const router = express.Router();
router.use(requireRole('student'));
router.use(requireStudentInfo);
router.use(lockNonMembers);

/* Count of the student's pending applications, shown as a sidebar badge. */
async function countPending(uid) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'pending'",
    [uid],
  );
  return row.c;
}

/* The student's applications, newest first (optionally only the latest `limit`). */
async function getApplications(uid, limit) {
  const [apps] = await db.query(
    `
    SELECT a.*, o.name AS org_name, o.logo_text, o.color
    FROM applications a JOIN organizations o ON o.id = a.org_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`,
    [uid],
  );
  return apps;
}

/* Runs on every student page so the sidebar badge is always current. */
async function loadBadge(req, res, next) {
  res.locals.badge = await countPending(req.session.user.id);
  next();
}

async function showHome(req, res) {
  const uid = req.session.user.id;
  const orgs = await getOrgs(uid);
  const upcoming = await getUpcomingSummary();
  const [[joined]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [
    uid,
  ]);

  res.render('student/home', {
    title: 'Home',
    active: 'home',
    orgs,
    events: upcoming.events,
    apps: await getApplications(uid, 2),
    cats: [...new Set(orgs.map((o) => o.category))],
    stats: {
      active: await countPending(uid),
      joined: joined.c,
      upcoming: upcoming.total,
    },
  });
}

async function showApplications(req, res) {
  const uid = req.session.user.id;
  const orgs = await getOrgs(uid);

  res.render('student/applications', {
    title: 'Applications',
    active: 'applications',
    apps: await getApplications(uid),
    byId: Object.fromEntries(orgs.map((o) => [o.id, o])),
  });
}

/* Toggles saved / not saved and replies with the new state as JSON. */
async function toggleBookmark(req, res) {
  const uid = req.session.user.id;
  const [removed] = await db.query('DELETE FROM bookmarks WHERE user_id = ? AND org_id = ?', [
    uid,
    req.params.id,
  ]);

  if (removed.affectedRows) {
    return res.json({ saved: false });
  }
  await db.query('INSERT IGNORE INTO bookmarks (user_id, org_id) VALUES (?,?)', [
    uid,
    req.params.id,
  ]);
  res.json({ saved: true });
}

async function showMyOrganizations(req, res) {
  const [mine] = await db.query(
    `
    SELECT o.*, m.joined_at, m.role_title,
      (SELECT COUNT(*) FROM events e WHERE e.org_id = o.id AND ${UPCOMING}) AS upcoming
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
    [req.session.user.id],
  );
  res.render('student/organizations', { title: 'My organizations', active: 'orgs', mine });
}

/* ---------- Routes ---------- */
router.use(wrap(loadBadge));
router.get('/', wrap(showHome));
router.get('/applications', wrap(showApplications));
router.post('/bookmark/:id', wrap(toggleBookmark));
router.get('/organizations', wrap(showMyOrganizations));

/* Discover, Apply, Events and RSVP */
addSharedPages(router, { view: 'student', base: '/student' });

module.exports = router;
