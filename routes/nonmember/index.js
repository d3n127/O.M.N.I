const express = require('express');
const db = require('../../conn').promise();
const { wrap, requireRole, requireNonMember } = require('../../middleware');
const { applyToOrg } = require('../apply');

const router = express.Router();
router.use(requireRole('student'));
router.use(requireNonMember);

// same visibility predicate as routes/student/index.js (spec-events §2.1)
const UPCOMING = "e.status = 'published' AND e.event_date >= CURDATE()";

// same organization shape as getOrgs in routes/student/index.js (FR-NONMEMBER-1)
async function getOrgs(uid, q) {
  const params = [uid, uid, uid];
  let where = '';
  if (q) {
    const l = `%${q}%`;
    where = 'WHERE o.name LIKE ? OR o.description LIKE ? OR o.tags LIKE ? OR o.category LIKE ?';
    params.push(l, l, l, l);
  }
  const [rows] = await db.query(`
    SELECT o.*,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.org_id = o.id AND b.user_id = ?) AS saved,
      (SELECT a.status FROM applications a WHERE a.org_id = o.id AND a.user_id = ?) AS app_status,
      EXISTS(SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = ?) AS is_member
    FROM organizations o ${where} ORDER BY o.id`, params);
  return rows;
}

/* ---------- Limited home ---------- */
router.get('/', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const orgs = await getOrgs(uid);
  const [[upc]] = await db.query(`SELECT COUNT(*) AS c FROM events e WHERE ${UPCOMING}`);
  const [events] = await db.query(`
    SELECT e.*, o.name AS org_name FROM events e JOIN organizations o ON o.id = e.org_id
    WHERE ${UPCOMING} ORDER BY e.event_date, e.event_time LIMIT 3`);
  res.render('nonmember/home', {
    title: 'Home', active: 'home', orgs, events,
    cats: [...new Set(orgs.map((o) => o.category))],
    stats: { explore: orgs.length, upcoming: upc.c }
  });
}));

/* ---------- Discover (FR-NONMEMBER-2) ---------- */
router.get('/discover', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const orgs = await getOrgs(req.session.user.id, q);
  const [all] = await db.query('SELECT DISTINCT category FROM organizations ORDER BY category');
  res.render('nonmember/discover', { title: 'Discover', active: 'discover', orgs, q, cats: all.map((r) => r.category) });
}));

/* ---------- Apply (FR-NONMEMBER-3, shared body with FR-STUDENT-3) ---------- */
router.post('/apply', wrap(applyToOrg));

/* ---------- Events (FR-NONMEMBER-4) ---------- */
router.get('/events', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const orgId = Number(req.query.org) || null;
  const params = [uid];
  if (orgId) params.push(orgId);
  const [events] = await db.query(`
    SELECT e.*, o.name AS org_name,
      EXISTS(SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS joined
    FROM events e JOIN organizations o ON o.id = e.org_id
    WHERE ${UPCOMING} ${orgId ? 'AND e.org_id = ?' : ''}
    ORDER BY e.event_date, e.event_time`, params);
  let filterOrg = null;
  if (orgId) {
    const [[o]] = await db.query('SELECT name FROM organizations WHERE id = ?', [orgId]);
    filterOrg = o ? o.name : null;
  }
  res.render('nonmember/events', { title: 'Events', active: 'events', events, filterOrg });
}));

/* ---------- RSVP (FR-NONMEMBER-5, publish-state guard from FR-STUDENT-6) ---------- */
router.post('/events/:id/rsvp', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const [r] = await db.query('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?', [req.params.id, uid]);
  if (!r.affectedRows) {
    await db.query("INSERT IGNORE INTO rsvps (event_id, user_id) SELECT id, ? FROM events WHERE id = ? AND status = 'published'", [uid, req.params.id]);
  }
  res.redirect(req.get('Referer') || '/nonmember/events');
}));

module.exports = router;
