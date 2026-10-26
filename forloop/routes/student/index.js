/*
 * Student portal (/student): students who belong to at least one organization.
 * Home, Applications, Bookmarks and My organizations are defined here;
 * Discover, Apply, Events and RSVP come from ../portal.
 */
const express = require('express');
const db = require('../../conn');
const { parallel } = require('../../utils');
const { requireRole, lockNonMembers, requireStudentInfo } = require('../auth');
const { UPCOMING, getOrgs, getUpcomingSummary, addSharedPages } = require('../portal');

const router = express.Router();
router.use(requireRole('student'));
router.use(requireStudentInfo);
router.use(lockNonMembers);

/* Count of the student's pending applications, shown as a sidebar badge. done(err, number) */
function countPending(uid, done) {
  db.query(
    "SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'pending'",
    [uid],
    (err, rows) => {
      if (err) {
        return done(err);
      }
      done(null, rows[0].c);
    },
  );
}

/* The student's applications, newest first. Pass a `limit` for only the latest few, or 0 for all. done(err, apps) */
function getApplications(uid, limit, done) {
  db.query(
    `
    SELECT a.*, o.name AS org_name, o.logo_img, o.color
    FROM applications a JOIN organizations o ON o.id = a.org_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`,
    [uid],
    done,
  );
}

/* Runs on every student page so the sidebar badge is always current. */
function loadBadge(req, res, next) {
  countPending(req.session.user.id, (err, pending) => {
    if (err) {
      return next(err);
    }
    res.locals.badge = pending;
    next();
  });
}

function showHome(req, res, next) {
  const uid = req.session.user.id;

  parallel(
    {
      orgs: (cb) => getOrgs(uid, '', cb),
      upcoming: (cb) => getUpcomingSummary(3, cb),
      joined: (cb) => db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid], cb),
      apps: (cb) => getApplications(uid, 2, cb),
      pending: (cb) => countPending(uid, cb),
    },
    (err, results) => {
      if (err) {
        return next(err);
      }
      const { orgs, upcoming } = results;

      res.render('student/home', {
        title: 'Home',
        active: 'home',
        orgs,
        events: upcoming.events,
        apps: results.apps,
        cats: [...new Set(orgs.map((o) => o.category))],
        stats: {
          active: results.pending,
          joined: results.joined[0].c,
          upcoming: upcoming.total,
        },
      });
    },
  );
}

function showApplications(req, res, next) {
  const uid = req.session.user.id;

  parallel(
    {
      apps: (cb) => getApplications(uid, 0, cb),
      orgs: (cb) => getOrgs(uid, '', cb),
    },
    (err, results) => {
      if (err) {
        return next(err);
      }
      res.render('student/applications', {
        title: 'Applications',
        active: 'applications',
        apps: results.apps,
        byId: Object.fromEntries(results.orgs.map((o) => [o.id, o])),
      });
    },
  );
}

/* Toggles saved / not saved and replies with the new state as JSON. */
function toggleBookmark(req, res, next) {
  const uid = req.session.user.id;

  db.query(
    'DELETE FROM bookmarks WHERE user_id = ? AND org_id = ?',
    [uid, req.params.id],
    (err, removed) => {
      if (err) {
        return next(err);
      }
      if (removed.affectedRows) {
        return res.json({ saved: false });
      }

      db.query(
        'INSERT IGNORE INTO bookmarks (user_id, org_id) VALUES (?,?)',
        [uid, req.params.id],
        (err) => {
          if (err) {
            return next(err);
          }
          res.json({ saved: true });
        },
      );
    },
  );
}

function showMyOrganizations(req, res, next) {
  db.query(
    `
    SELECT o.*, m.joined_at, m.role_title,
      (SELECT COUNT(*) FROM events e WHERE e.org_id = o.id AND ${UPCOMING}) AS upcoming
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
    [req.session.user.id],
    (err, mine) => {
      if (err) {
        return next(err);
      }
      res.render('student/organizations', { title: 'My organizations', active: 'orgs', mine });
    },
  );
}

/* ---------- Routes ---------- */
router.use(loadBadge);
router.get('/', showHome);
router.get('/applications', showApplications);
router.post('/bookmark/:id', toggleBookmark);
router.get('/organizations', showMyOrganizations);

/* Discover, Apply, Events and RSVP */
addSharedPages(router, { view: 'student', base: '/student' });

module.exports = router;
