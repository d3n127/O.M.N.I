/*
 * Pages shared by the student portal and the non-member portal:
 * Discover, Apply, Events and RSVP. Each portal calls addSharedPages()
 * with its own view folder ("student" / "nonmember") and URL prefix.
 */
const db = require('../conn').promise();
const { wrap, text } = require('../utils');
const { applyToOrg } = require('./apply');

/* SQL condition: events students are allowed to see. */
const UPCOMING = "e.status = 'published' AND e.event_date >= CURDATE()";

/* Organizations with member count and this user's saved / application / member state. */
async function getOrgs(uid, search = '') {
  const params = [uid, uid, uid];
  let where = '';

  if (search) {
    const like = `%${search}%`;
    where =
      'WHERE o.name LIKE ? OR o.description LIKE ? OR o.tags LIKE ? OR o.category LIKE ? OR o.eligibility LIKE ?';
    params.push(like, like, like, like, like);
  }

  const [orgs] = await db.query(
    `
    SELECT o.*,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.org_id = o.id AND b.user_id = ?) AS saved,
      (SELECT a.status FROM applications a WHERE a.org_id = o.id AND a.user_id = ?) AS app_status,
      EXISTS(SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = ?) AS is_member
    FROM organizations o ${where} ORDER BY o.id`,
    params,
  );
  return orgs;
}

/* The next few upcoming events across all organizations, plus how many exist. */
async function getUpcomingSummary(limit = 3) {
  const [[count]] = await db.query(`SELECT COUNT(*) AS c FROM events e WHERE ${UPCOMING}`);
  const [events] = await db.query(
    `
    SELECT e.*, o.name AS org_name FROM events e JOIN organizations o ON o.id = e.org_id
    WHERE ${UPCOMING} ORDER BY e.event_date, e.event_time LIMIT ?`,
    [limit],
  );
  return { total: count.c, events };
}

/* Distinct organization categories, used by the filter chips. */
async function getAllCategories() {
  const [rows] = await db.query('SELECT DISTINCT category FROM organizations ORDER BY category');
  return rows.map((r) => r.category);
}

/* Registers Discover, Apply, Events and RSVP on a portal's router. */
function addSharedPages(router, { view, base }) {
  /* Browse and search organizations */
  async function showDiscover(req, res) {
    const q = text(req.query.q);
    res.render(`${view}/discover`, {
      title: 'Discover',
      active: 'discover',
      orgs: await getOrgs(req.session.user.id, q),
      q,
      cats: await getAllCategories(),
    });
  }

  /* Upcoming events, optionally filtered to one organization (?org=ID) */
  async function showEvents(req, res) {
    const orgId = Number(req.query.org) || null;
    const params = [req.session.user.id];
    if (orgId) {
      params.push(orgId);
    }

    const [events] = await db.query(
      `
      SELECT e.*, o.name AS org_name,
        EXISTS(SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS joined
      FROM events e JOIN organizations o ON o.id = e.org_id
      WHERE ${UPCOMING} ${orgId ? 'AND e.org_id = ?' : ''}
      ORDER BY e.event_date, e.event_time`,
      params,
    );

    let filterOrg = null;
    if (orgId) {
      const [[org]] = await db.query('SELECT name FROM organizations WHERE id = ?', [orgId]);
      filterOrg = org ? org.name : null;
    }

    res.render(`${view}/events`, { title: 'Events', active: 'events', events, filterOrg });
  }

  /* RSVP toggles: a second click cancels the first */
  async function toggleRsvp(req, res) {
    const uid = req.session.user.id;
    const [removed] = await db.query('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?', [
      req.params.id,
      uid,
    ]);

    if (!removed.affectedRows) {
      await db.query(
        "INSERT IGNORE INTO rsvps (event_id, user_id) SELECT id, ? FROM events WHERE id = ? AND status = 'published'",
        [uid, req.params.id],
      );
    }
    res.redirect(req.get('Referer') || `${base}/events`);
  }

  router.get('/discover', wrap(showDiscover));
  router.post('/apply', wrap(applyToOrg));
  router.get('/events', wrap(showEvents));
  router.post('/events/:id/rsvp', wrap(toggleRsvp));
}

module.exports = { UPCOMING, getOrgs, getUpcomingSummary, addSharedPages };
