/*
 * Pages shared by the student portal and the non-member portal:
 * Discover, Apply, Events and RSVP. Each portal calls addSharedPages()
 * with its own view folder ("student" / "nonmember") and URL prefix.
 */
const db = require('../conn');
const { text, parallel } = require('../utils');
const { applyToOrg } = require('./apply');
const { attachProgram } = require('./program');

/* SQL condition: events students are allowed to see. */
const UPCOMING = "e.status = 'published' AND e.event_date >= CURDATE()";

/*
 * Organizations with member count and this user's saved / application / member state.
 * Pass '' as `search` to get every organization. done(err, orgs)
 */
function getOrgs(uid, search, done) {
  const params = [uid, uid, uid];
  let where = '';

  if (search) {
    const like = `%${search}%`;
    where =
      'WHERE o.name LIKE ? OR o.description LIKE ? OR o.tags LIKE ? OR o.category LIKE ? OR o.eligibility LIKE ?';
    params.push(like, like, like, like, like);
  }

  db.query(
    `
    SELECT o.*,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.org_id = o.id AND b.user_id = ?) AS saved,
      (SELECT a.status FROM applications a WHERE a.org_id = o.id AND a.user_id = ?) AS app_status,
      EXISTS(SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = ?) AS is_member
    FROM organizations o ${where} ORDER BY o.id`,
    params,
    done,
  );
}

/* The next `limit` upcoming events across all organizations, plus how many exist. done(err, { total, events }) */
function getUpcomingSummary(limit, done) {
  parallel(
    {
      count: (cb) => db.query(`SELECT COUNT(*) AS c FROM events e WHERE ${UPCOMING}`, cb),
      events: (cb) =>
        db.query(
          `
          SELECT e.*, o.name AS org_name FROM events e JOIN organizations o ON o.id = e.org_id
          WHERE ${UPCOMING} ORDER BY e.event_date, e.event_time LIMIT ?`,
          [limit],
          cb,
        ),
    },
    (err, results) => {
      if (err) {
        return done(err);
      }
      done(null, { total: results.count[0].c, events: results.events });
    },
  );
}

/* Distinct organization categories, used by the filter chips. done(err, ['Creative', ...]) */
function getAllCategories(done) {
  db.query('SELECT DISTINCT category FROM organizations ORDER BY category', (err, rows) => {
    if (err) {
      return done(err);
    }
    done(
      null,
      rows.map((r) => r.category),
    );
  });
}

/* Registers Discover, Apply, Events and RSVP on a portal's router. */
function addSharedPages(router, { view, base }) {
  /* Browse and search organizations */
  function showDiscover(req, res, next) {
    const q = text(req.query.q);

    parallel(
      {
        orgs: (cb) => getOrgs(req.session.user.id, q, cb),
        cats: (cb) => getAllCategories(cb),
      },
      (err, results) => {
        if (err) {
          return next(err);
        }
        res.render(`${view}/discover`, {
          title: 'Discover',
          active: 'discover',
          orgs: results.orgs,
          q,
          cats: results.cats,
        });
      },
    );
  }

  /* The organization's name when filtering by ?org=ID, otherwise null. done(err, name | null) */
  function getFilterName(orgId, done) {
    if (!orgId) {
      return done(null, null);
    }
    db.query('SELECT name FROM organizations WHERE id = ?', [orgId], (err, rows) => {
      if (err) {
        return done(err);
      }
      done(null, rows.length ? rows[0].name : null);
    });
  }

  /* Upcoming events, optionally filtered to one organization (?org=ID) */
  function showEvents(req, res, next) {
    const orgId = Number(req.query.org) || null;
    const params = [req.session.user.id];
    if (orgId) {
      params.push(orgId);
    }

    parallel(
      {
        events: (cb) =>
          db.query(
            `
            SELECT e.*, o.name AS org_name,
              EXISTS(SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS joined
            FROM events e JOIN organizations o ON o.id = e.org_id
            WHERE ${UPCOMING} ${orgId ? 'AND e.org_id = ?' : ''}
            ORDER BY e.event_date, e.event_time`,
            params,
            cb,
          ),
        filterOrg: (cb) => getFilterName(orgId, cb),
      },
      (err, results) => {
        if (err) {
          return next(err);
        }
        attachProgram(results.events, (err) => {
          if (err) {
            return next(err);
          }
          res.render(`${view}/events`, {
            title: 'Events',
            active: 'events',
            events: results.events,
            filterOrg: results.filterOrg,
          });
        });
      },
    );
  }

  /* RSVP toggles: a second click cancels the first */
  function toggleRsvp(req, res, next) {
    const uid = req.session.user.id;

    function backToPage() {
      res.redirect(req.get('Referer') || `${base}/events`);
    }

    db.query(
      'DELETE FROM rsvps WHERE event_id = ? AND user_id = ?',
      [req.params.id, uid],
      (err, removed) => {
        if (err) {
          return next(err);
        }
        if (removed.affectedRows) {
          return backToPage();
        }

        db.query(
          "INSERT IGNORE INTO rsvps (event_id, user_id) SELECT id, ? FROM events WHERE id = ? AND status = 'published'",
          [uid, req.params.id],
          (err) => {
            if (err) {
              return next(err);
            }
            backToPage();
          },
        );
      },
    );
  }

  router.get('/discover', showDiscover);
  router.post('/apply', applyToOrg);
  router.get('/events', showEvents);
  router.post('/events/:id/rsvp', toggleRsvp);
}

module.exports = { UPCOMING, getOrgs, getUpcomingSummary, addSharedPages };
