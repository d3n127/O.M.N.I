const express = require('express');
const db = require('../../conn').promise();
const { MON, DEPT_NAMES, wrap, flash } = require('../../utils');
const { requireRole } = require('../auth');

const router = express.Router();
/* RBAC: the organization portal is adviser-only */
router.use(requireRole('adviser'));

const CATEGORIES = ['Technology', 'Creative', 'Academic', 'Sports', 'Community', 'Business'];

/* Role titles valid for this organization (loaded per-request in middleware below). */
function orgRoleTitles(orgRoles) { return orgRoles.map((r) => r.role_title); }
/* The default role for newly invited members: the lowest-precedence role (e.g. Member). */
function defaultMemberRole(orgRoles) {
  const sorted = [...orgRoles].sort((a, b) => b.precedence - a.precedence);
  return sorted[0] ? sorted[0].role_title : 'Member';
}

// same visibility predicate as routes/student/index.js (spec-events §2.1)
const UPCOMING = "e.status = 'published' AND e.event_date >= CURDATE()";

// load this adviser's organization + pending badge for every advisor page
router.use(wrap(async (req, res, next) => {
  const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [req.session.user.org_id]);
  if (!org) return req.session.destroy(() => res.redirect('/'));
  const [[p]] = await db.query("SELECT COUNT(*) AS c FROM applications WHERE org_id = ? AND status = 'pending'", [org.id]);
  const [roles] = await db.query('SELECT * FROM org_roles WHERE org_id = ? ORDER BY precedence, id', [org.id]);
  res.locals.org = org;
  res.locals.orgRoles = roles;
  res.locals.badge = p.c;
  next();
}));

/* shared numbers used by Overview + Reports */
async function orgStats(org) {
  const [[m]] = await db.query(
    "SELECT COUNT(*) AS total, SUM(joined_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS fresh FROM memberships WHERE org_id = ?", [org.id]);
  const [[p]] = await db.query("SELECT COUNT(*) AS c FROM applications WHERE org_id = ? AND status = 'pending'", [org.id]);
  const [[u]] = await db.query(`
    SELECT COUNT(DISTINCT e.id) AS ev, COUNT(r.user_id) AS rs
    FROM events e LEFT JOIN rsvps r ON r.event_id = e.id
    WHERE e.org_id = ? AND e.status = 'published' AND e.event_date >= CURDATE()`, [org.id]);
  const [[a]] = await db.query(`
    SELECT COUNT(DISTINCT e.id) AS ev, COUNT(r.user_id) AS rs
    FROM events e LEFT JOIN rsvps r ON r.event_id = e.id
    WHERE e.org_id = ? AND e.status = 'published'`, [org.id]);
  const [[d]] = await db.query(
    "SELECT SUM(status = 'approved') AS ap, SUM(status = 'rejected') AS rj FROM applications WHERE org_id = ?", [org.id]);

  const members = Number(m.total );
  const attendance = a.ev && members ? Math.min(100, Math.round((a.rs / (a.ev * members)) * 100)) : 0;
  const decided = Number(d.ap || 0) + Number(d.rj || 0);
  const acceptance = decided ? Math.round((Number(d.ap || 0) / decided) * 100) : 0;
  const score = Math.round((attendance + acceptance + Number(org.satisfaction) * 20) / 3);
  return {
    members, fresh: Number(m.fresh || 0), pending: p.c,
    upcoming: u.ev, upcomingRsvps: u.rs, attendance, acceptance, score
  };
}

/* ---------- Overview ---------- */
router.get('/', wrap(async (req, res) => {
  const org = res.locals.org;
  const stats = await orgStats(org);
  const [recent] = await db.query(`
    SELECT a.*, u.full_name, u.student_id, u.program, u.year_level FROM applications a JOIN users u ON u.id = a.user_id
    WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 3`, [org.id]);
  // FR-EVENTS-7: next 5 upcoming published events of this org, each with its RSVP count
  const [upcoming] = await db.query(`
    SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvps
    FROM events e WHERE e.org_id = ? AND ${UPCOMING}
    ORDER BY e.event_date, e.event_time LIMIT 5`, [org.id]);
  const featured = upcoming[0] || null;
  let going = [], goingCount = 0;
  if (featured) {
    [going] = await db.query('SELECT u.full_name FROM rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? LIMIT 3', [featured.id]);
    [[{ c: goingCount }]] = await db.query('SELECT COUNT(*) AS c FROM rsvps WHERE event_id = ?', [featured.id]);
  }
  const now = new Date();
  const hour = now.getHours();
  res.render('admin/overview', {
    title: 'Overview', active: 'overview', stats, recent, featured, upcoming, going, goingCount,
    greeting: hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening',
    today: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    firstName: req.session.user.name.split(' ')[0]
  });
}));

/* ---------- Organization profile ---------- */
router.get('/organization', wrap(async (req, res) => {
  const [[c]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?', [res.locals.org.id]);
  res.render('admin/organization', { title: 'Organization', active: 'organization', memberCount: c.c, categories: CATEGORIES, departments: DEPT_NAMES });
}));

router.post('/organization', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) { flash(req, 'Organization name cannot be empty.', 'err'); return res.redirect('/admin/organization'); }
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Technology';
  /* who can join: "International" (any department) or one specific department */
  const eligibility = req.body.eligibility === 'International' || DEPT_NAMES.includes(req.body.eligibility)
    ? req.body.eligibility : 'International';
  const logo = String(req.body.logo_text || '').trim().slice(0, 4) || name.slice(0, 2).toUpperCase();
  await db.query(
    'UPDATE organizations SET name = ?, description = ?, category = ?, tags = ?, eligibility = ?, logo_text = ?, meeting_schedule = ? WHERE id = ?',
    [name, String(req.body.description || '').trim(), category, String(req.body.tags || '').trim().slice(0, 160),
      eligibility, logo, String(req.body.meeting_schedule || '').trim() || 'To be announced', res.locals.org.id]);
  flash(req, 'Changes saved. Students can see your updated profile now.');
  res.redirect('/admin/organization');
}));

/* ---------- Members ---------- */
router.get('/members', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [res.locals.org.id];
  let where = '';
  if (q) { where = 'AND (u.full_name LIKE ? OR u.email LIKE ? OR m.role_title LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const [members] = await db.query(`
    SELECT m.id AS mid, m.role_title, m.joined_at, u.full_name, u.email
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN org_roles o ON o.org_id = m.org_id AND o.role_title = m.role_title
    WHERE m.org_id = ? ${where}
    ORDER BY COALESCE(o.precedence, 999), m.joined_at`, params);
  res.render('admin/members', { title: 'Members', active: 'members', members, q, roles: res.locals.orgRoles });
}));

router.post('/members/invite', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const [[u]] = await db.query("SELECT id, full_name FROM users WHERE email = ? AND role = 'student'", [email]);
  if (!u) { flash(req, 'No student account uses that email yet. Ask them to sign up first.', 'err'); return res.redirect('/admin/members'); }
  const [r] = await db.query("INSERT IGNORE INTO memberships (org_id, user_id, role_title, joined_at) VALUES (?,?, ?, CURDATE())", [res.locals.org.id, u.id, defaultMemberRole(res.locals.orgRoles)]);
  if (!r.affectedRows) { flash(req, `${u.full_name} is already a member.`, 'err'); return res.redirect('/admin/members'); }
  await db.query('INSERT INTO notifications (user_id, message) VALUES (?,?)', [u.id, `You were added to ${res.locals.org.name}. Welcome!`]);
  flash(req, `${u.full_name} joined ${res.locals.org.name}.`);
  res.redirect('/admin/members');
}));

router.post('/members/:mid/role', wrap(async (req, res) => {
  const roleTitles = orgRoleTitles(res.locals.orgRoles);
  if (roleTitles.includes(req.body.role)) {
    await db.query('UPDATE memberships SET role_title = ? WHERE id = ? AND org_id = ?', [req.body.role, req.params.mid, res.locals.org.id]);
    flash(req, 'Role updated.');
  }
  res.redirect('/admin/members');
}));

router.post('/members/:mid/remove', wrap(async (req, res) => {
  await db.query('DELETE FROM memberships WHERE id = ? AND org_id = ?', [req.params.mid, res.locals.org.id]);
  flash(req, 'Member removed.');
  res.redirect('/admin/members');
}));

/* ---------- Officer hierarchy ---------- */
router.get('/officers', wrap(async (req, res) => {
  const roles = res.locals.orgRoles;
  const [usage] = await db.query(`
    SELECT o.role_title, COUNT(m.id) AS n
    FROM org_roles o LEFT JOIN memberships m ON m.org_id = o.org_id AND m.role_title = o.role_title
    WHERE o.org_id = ? GROUP BY o.id`, [res.locals.org.id]);
  const useCount = {};
  usage.forEach((u) => { useCount[u.role_title] = Number(u.n); });
  res.render('admin/officers', { title: 'Officers', active: 'officers', roles, useCount });
}));

router.post('/officers', wrap(async (req, res) => {
  const orgId = res.locals.org.id;
  const action = req.body.action;
  const roles = res.locals.orgRoles;

  if (action === 'reorder') {
    const id = Number(req.body.role_id);
    const dir = req.body.dir; // 'up' or 'down'
    const role = roles.find((r) => r.id === id);
    if (!role) { flash(req, 'Role not found.', 'err'); return res.redirect('/admin/officers'); }
    const target = dir === 'up'
      ? roles.find((r) => r.precedence === role.precedence - 1)
      : roles.find((r) => r.precedence === role.precedence + 1);
    if (!target) { flash(req, 'Cannot move further.', 'err'); return res.redirect('/admin/officers'); }
    await db.query('UPDATE org_roles SET precedence = ? WHERE id = ? AND org_id = ?', [target.precedence, id, orgId]);
    await db.query('UPDATE org_roles SET precedence = ? WHERE id = ? AND org_id = ?', [role.precedence, target.id, orgId]);
    flash(req, `Role “${role.role_title}” moved ${dir}.`);
  } else if (action === 'add') {
    const title = String(req.body.role_title || '').trim();
    if (!title) { flash(req, 'Role title cannot be empty.', 'err'); return res.redirect('/admin/officers'); }
    const titles = roles.map((r) => r.role_title);
    if (titles.includes(title)) { flash(req, 'That role already exists.', 'err'); return res.redirect('/admin/officers'); }
    const nextPrec = Math.max(0, ...roles.map((r) => r.precedence)) + 1;
    await db.query('INSERT INTO org_roles (org_id, role_title, precedence, is_officer) VALUES (?,?,?,1)', [orgId, title, nextPrec]);
    flash(req, `Role “${title}” added.`);
  } else if (action === 'remove') {
    const id = Number(req.body.role_id);
    const role = roles.find((r) => r.id === id);
    if (!role) { flash(req, 'Role not found.', 'err'); return res.redirect('/admin/officers'); }
    if (roles.length <= 1) { flash(req, 'Keep at least one role.', 'err'); return res.redirect('/admin/officers'); }
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role_title = ?', [orgId, role.role_title]);
    if (Number(n) > 0) { flash(req, `Cannot remove “${role.role_title}”: ${n} member(s) currently hold it.`, 'err'); return res.redirect('/admin/officers'); }
    await db.query('DELETE FROM org_roles WHERE id = ? AND org_id = ?', [id, orgId]);
    flash(req, `Role “${role.role_title}” removed.`);
  }
  res.redirect('/admin/officers');
}));

/* ---------- Applications ---------- */
router.get('/applications', wrap(async (req, res) => {
  const [apps] = await db.query(`
    SELECT a.*, u.full_name, u.student_id, u.program, u.year_level FROM applications a JOIN users u ON u.id = a.user_id
    WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC`, [res.locals.org.id]);
  res.render('admin/applications', { title: 'Applications', active: 'applications', apps });
}));

router.post('/applications/:id/:action', wrap(async (req, res) => {
  const { id, action } = req.params;
  const org = res.locals.org;
  if (!['approve', 'decline'].includes(action)) return res.redirect('/admin/applications');
  const [[a]] = await db.query('SELECT * FROM applications WHERE id = ? AND org_id = ?', [id, org.id]);
  if (!a || a.status !== 'pending') return res.redirect('/admin/applications');

  const approve = action === 'approve';
  await db.query('UPDATE applications SET status = ?, reviewed_at = NOW() WHERE id = ?', [approve ? 'approved' : 'rejected', id]);
  if (approve) {
    await db.query("INSERT IGNORE INTO memberships (org_id, user_id, role_title, joined_at) VALUES (?,?, ?, CURDATE())", [org.id, a.user_id, defaultMemberRole(res.locals.orgRoles)]);
  }
  await db.query('INSERT INTO notifications (user_id, message) VALUES (?,?)', [a.user_id,
    approve ? `${org.name} accepted your application. Welcome aboard!` : `${org.name} declined your application. You can revise it and apply again.`]);
  flash(req, approve ? 'Application approved. They are now a member.' : 'Application declined.');
  res.redirect('/admin/applications');
}));

/* ---------- Events ---------- */
router.get('/events', wrap(async (req, res) => {
  const [events] = await db.query(`
    SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvps
    FROM events e WHERE e.org_id = ? ORDER BY e.event_date, e.event_time`, [res.locals.org.id]);
  res.render('admin/events', { title: 'Events', active: 'events', events });
}));

function readEvent(body) {
  const e = {
    title: String(body.title || '').trim(),
    date: String(body.event_date || ''),
    time: String(body.event_time || ''),
    location: String(body.location || '').trim() || 'TBA',
    description: String(body.description || '').trim(),
    status: body.status === 'published' ? 'published' : 'draft'
  };
  const ok = e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && /^\d{2}:\d{2}/.test(e.time);
  return ok ? e : null;
}

async function notifyMembers(org, title) {
  await db.query('INSERT INTO notifications (user_id, message) SELECT user_id, ? FROM memberships WHERE org_id = ?',
    [`New event from ${org.name}: ${title}`, org.id]);
}

router.post('/events', wrap(async (req, res) => {
  const e = readEvent(req.body);
  if (!e) { flash(req, 'Add a title, date and time to create the event.', 'err'); return res.redirect('/admin/events'); }
  await db.query('INSERT INTO events (org_id, title, event_date, event_time, location, description, status) VALUES (?,?,?,?,?,?,?)',
    [res.locals.org.id, e.title, e.date, e.time, e.location, e.description, e.status]);
  if (e.status === 'published') await notifyMembers(res.locals.org, e.title);
  flash(req, e.status === 'published' ? 'Event published. Members were notified.' : 'Draft saved.');
  res.redirect('/admin/events');
}));

router.post('/events/:id', wrap(async (req, res) => {
  const e = readEvent(req.body);
  if (!e) { flash(req, 'Add a title, date and time to save the event.', 'err'); return res.redirect('/admin/events'); }
  const [[old]] = await db.query('SELECT status FROM events WHERE id = ? AND org_id = ?', [req.params.id, res.locals.org.id]);
  if (!old) return res.redirect('/admin/events');
  await db.query('UPDATE events SET title = ?, event_date = ?, event_time = ?, location = ?, description = ?, status = ? WHERE id = ?',
    [e.title, e.date, e.time, e.location, e.description, e.status, req.params.id]);
  if (old.status !== 'published' && e.status === 'published') await notifyMembers(res.locals.org, e.title);
  flash(req, 'Event saved.');
  res.redirect('/admin/events');
}));

router.post('/events/:id/delete', wrap(async (req, res) => {
  await db.query('DELETE FROM events WHERE id = ? AND org_id = ?', [req.params.id, res.locals.org.id]);
  flash(req, 'Event deleted.');
  res.redirect('/admin/events');
}));

/* ---------- Reports ---------- */
async function growth(orgId) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MON[d.getMonth()], count: 0 });
  }
  const [rows] = await db.query(
    "SELECT DATE_FORMAT(joined_at, '%Y-%m') AS ym, COUNT(*) AS c FROM memberships WHERE org_id = ? AND joined_at >= ? GROUP BY ym",
    [orgId, months[0].key + '-01']);
  rows.forEach((r) => { const m = months.find((x) => x.key === r.ym); if (m) m.count = Number(r.c); });
  return months;
}

router.get('/reports', wrap(async (req, res) => {
  const stats = await orgStats(res.locals.org);
  const months = await growth(res.locals.org.id);
  res.render('admin/reports', { title: 'Reports', active: 'reports', stats, months, max: Math.max(1, ...months.map((m) => m.count)) });
}));

router.get('/reports/export', wrap(async (req, res) => {
  const org = res.locals.org;
  const stats = await orgStats(org);
  const months = await growth(org.id);
  const lines = [`Report for ${org.name}`, '', 'Metric,Value',
    `Total members,${stats.members}`, `Pending applications,${stats.pending}`, `Upcoming events,${stats.upcoming}`,
    `Application acceptance %,${stats.acceptance}`, `Event attendance %,${stats.attendance}`, `Member satisfaction,${org.satisfaction}`,
    '', 'Month,New members', ...months.map((m) => `${m.label},${m.count}`)];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${org.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-report.csv"`);
  res.send(lines.join('\n'));
}));

module.exports = router;
