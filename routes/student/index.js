const express = require('express');
const db = require('../../conn');
const { wrap, requireRole } = require('../../middleware');

const router = express.Router();
router.use(requireRole('student'));

// badge on the "Applications" tab = applications still waiting for a decision
router.use(wrap(async (req, res, next) => {
  const [[r]] = await db.query("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'pending'", [req.session.user.id]);
  res.locals.badge = r.c;
  next();
}));

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

async function getApplications(uid, limit) {
  const [rows] = await db.query(`
    SELECT a.*, o.name AS org_name, o.logo_text, o.color
    FROM applications a JOIN organizations o ON o.id = a.org_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`, [uid]);
  return rows;
}

const UPCOMING = "e.status = 'published' AND e.event_date >= CURDATE()";

/* ---------- Home ---------- */
router.get('/', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const orgs = await getOrgs(uid);
  const [[joined]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid]);
  const [[upc]] = await db.query(`SELECT COUNT(*) AS c FROM events e WHERE ${UPCOMING}`);
  const [events] = await db.query(`
    SELECT e.*, o.name AS org_name FROM events e JOIN organizations o ON o.id = e.org_id
    WHERE ${UPCOMING} ORDER BY e.event_date, e.event_time LIMIT 3`);
  const apps = await getApplications(uid, 2);
  const [[pend]] = await db.query("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'pending'", [uid]);
  res.render('student/home', {
    title: 'Home', active: 'home', orgs, events, apps,
    cats: [...new Set(orgs.map((o) => o.category))],
    stats: { active: pend.c, joined: joined.c, upcoming: upc.c }
  });
}));

/* ---------- Discover (browse + search) ---------- */
router.get('/discover', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const orgs = await getOrgs(req.session.user.id, q);
  const [all] = await db.query('SELECT DISTINCT category FROM organizations ORDER BY category');
  res.render('student/discover', { title: 'Discover', active: 'discover', orgs, q, cats: all.map((r) => r.category) });
}));

/* ---------- Applications ---------- */
router.get('/applications', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const apps = await getApplications(uid);
  const orgs = await getOrgs(uid);
  const byId = Object.fromEntries(orgs.map((o) => [o.id, o]));
  res.render('student/applications', { title: 'Applications', active: 'applications', apps, byId });
}));

router.post('/apply', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const orgId = Number(req.body.org_id);
  const intro = String(req.body.intro || '').trim();
  if (!intro) return res.status(400).json({ error: 'Write a short introduction so the team can get to know you.' });
  if (!req.body.agree) return res.status(400).json({ error: 'Agree to share your student profile to continue.' });

  const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [orgId]);
  if (!org) return res.status(404).json({ error: 'That organization no longer exists.' });
  const [mem] = await db.query('SELECT id FROM memberships WHERE org_id = ? AND user_id = ?', [orgId, uid]);
  if (mem.length) return res.status(400).json({ error: `You are already a member of ${org.name}.` });

  const [ex] = await db.query('SELECT * FROM applications WHERE org_id = ? AND user_id = ?', [orgId, uid]);
  if (ex.length) {
    if (ex[0].status !== 'rejected') return res.status(400).json({ error: 'You already applied. Check the Applications tab for updates.' });
    await db.query("UPDATE applications SET intro = ?, status = 'pending', created_at = NOW(), reviewed_at = NULL WHERE id = ?", [intro, ex[0].id]);
  } else {
    await db.query('INSERT INTO applications (org_id, user_id, intro) VALUES (?,?,?)', [orgId, uid, intro]);
  }
  await db.query("INSERT INTO notifications (user_id, message) SELECT id, ? FROM users WHERE role = 'admin' AND org_id = ?",
    [`${req.session.user.name} applied to join ${org.name}.`, orgId]);
  res.json({ ok: true, name: org.name });
}));

router.post('/bookmark/:id', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const [r] = await db.query('DELETE FROM bookmarks WHERE user_id = ? AND org_id = ?', [uid, req.params.id]);
  if (r.affectedRows) return res.json({ saved: false });
  await db.query('INSERT IGNORE INTO bookmarks (user_id, org_id) VALUES (?,?)', [uid, req.params.id]);
  res.json({ saved: true });
}));

/* ---------- Events ---------- */
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
  res.render('student/events', { title: 'Events', active: 'events', events, filterOrg });
}));

router.post('/events/:id/rsvp', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const [r] = await db.query('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?', [req.params.id, uid]);
  if (!r.affectedRows) {
    await db.query("INSERT IGNORE INTO rsvps (event_id, user_id) SELECT id, ? FROM events WHERE id = ? AND status = 'published'", [uid, req.params.id]);
  }
  res.redirect(req.get('Referer') || '/student/events');
}));

/* ---------- My organizations ---------- */
router.get('/organizations', wrap(async (req, res) => {
  const [mine] = await db.query(`
    SELECT o.*, m.joined_at, m.role_title,
      (SELECT COUNT(*) FROM events e WHERE e.org_id = o.id AND ${UPCOMING}) AS upcoming
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? ORDER BY m.joined_at DESC`, [req.session.user.id]);
  res.render('student/organizations', { title: 'My organizations', active: 'orgs', mine });
}));

module.exports = router;
