/*
 * Adviser portal (/admin): manages the adviser's one organization.
 * Sections: Overview, Organization profile, Members, Officers, Applications, Events, Reports.
 */
const express = require('express');
const db = require('../../conn').promise();
const { MON, DEPT_NAMES, wrap, flash, text, cleanEmail, ymd } = require('../../utils');
const { requireRole } = require('../auth');
const { UPCOMING } = require('../portal');

const router = express.Router();

const CATEGORIES = ['Technology', 'Creative', 'Academic', 'Sports', 'Community', 'Business'];

/* ---------- Setup for every admin page ---------- */

/* Load the adviser's organization, its roles and the pending-applications badge. */
async function loadOrganization(req, res, next) {
  const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [
    req.session.user.org_id,
  ]);
  if (!org) {
    return req.session.destroy(() => res.redirect('/'));
  }

  const [[pending]] = await db.query(
    "SELECT COUNT(*) AS c FROM applications WHERE org_id = ? AND status = 'pending'",
    [org.id],
  );
  const [roles] = await db.query(
    'SELECT * FROM org_roles WHERE org_id = ? ORDER BY precedence, id',
    [org.id],
  );

  res.locals.org = org;
  res.locals.orgRoles = roles;
  res.locals.badge = pending.c;
  next();
}

/* Role given to new members: the lowest-ranked one (highest precedence number). */
function defaultMemberRole(roles) {
  const lowest = [...roles].sort((a, b) => b.precedence - a.precedence)[0];
  return lowest ? lowest.role_title : 'Member';
}

/* Add a student to an organization. Returns false if they were already a member. */
async function addMember(orgId, userId, roleTitle) {
  const [result] = await db.query(
    'INSERT IGNORE INTO memberships (org_id, user_id, role_title, joined_at) VALUES (?,?,?, CURDATE())',
    [orgId, userId, roleTitle],
  );
  return result.affectedRows > 0;
}

const notifyUser = (userId, message) =>
  db.query('INSERT INTO notifications (user_id, message) VALUES (?,?)', [userId, message]);

/* ---------- Stats (used by Overview and Reports) ---------- */

/* Event and RSVP totals; `where` narrows which events count. */
async function countEvents(orgId, extraCondition = '') {
  const [[row]] = await db.query(
    `
    SELECT COUNT(DISTINCT e.id) AS events, COUNT(r.user_id) AS rsvps
    FROM events e LEFT JOIN rsvps r ON r.event_id = e.id
    WHERE e.org_id = ? AND e.status = 'published' ${extraCondition}`,
    [orgId],
  );
  return row;
}

async function orgStats(org) {
  const [[members]] = await db.query(
    "SELECT COUNT(*) AS total, SUM(joined_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS fresh FROM memberships WHERE org_id = ?",
    [org.id],
  );
  const [[pending]] = await db.query(
    "SELECT COUNT(*) AS c FROM applications WHERE org_id = ? AND status = 'pending'",
    [org.id],
  );
  const [[decisions]] = await db.query(
    "SELECT SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected FROM applications WHERE org_id = ?",
    [org.id],
  );
  const upcoming = await countEvents(org.id, 'AND e.event_date >= CURDATE()');
  const allEvents = await countEvents(org.id);

  const memberCount = Number(members.total);
  const approved = Number(decisions.approved || 0);
  const decided = approved + Number(decisions.rejected || 0);

  /* Percent of members who RSVPed to the average event */
  const attendance =
    allEvents.events && memberCount
      ? Math.min(100, Math.round((allEvents.rsvps / (allEvents.events * memberCount)) * 100))
      : 0;
  /* Percent of decided applications that were approved */
  const acceptance = decided ? Math.round((approved / decided) * 100) : 0;
  /* Satisfaction is out of 5, so x20 makes it a percent */
  const score = Math.round((attendance + acceptance + Number(org.satisfaction) * 20) / 3);

  return {
    members: memberCount,
    fresh: Number(members.fresh || 0),
    pending: pending.c,
    upcoming: upcoming.events,
    upcomingRsvps: upcoming.rsvps,
    attendance,
    acceptance,
    score,
  };
}

/* New members per month for the last 6 months, oldest first. */
async function memberGrowth(orgId) {
  const now = new Date();
  const months = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({ key: ymd(d).slice(0, 7), label: MON[d.getMonth()], count: 0 });
  }

  const [rows] = await db.query(
    "SELECT DATE_FORMAT(joined_at, '%Y-%m') AS ym, COUNT(*) AS c FROM memberships WHERE org_id = ? AND joined_at >= ? GROUP BY ym",
    [orgId, months[0].key + '-01'],
  );
  for (const row of rows) {
    const month = months.find((m) => m.key === row.ym);
    if (month) {
      month.count = Number(row.c);
    }
  }
  return months;
}

/* ---------- Overview ---------- */
async function showOverview(req, res) {
  const org = res.locals.org;

  const [recent] = await db.query(
    `
    SELECT a.*, u.full_name, u.student_id, u.program, u.year_level
    FROM applications a JOIN users u ON u.id = a.user_id
    WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 3`,
    [org.id],
  );

  /* The next 5 upcoming events; the first one is featured with who is going */
  const [upcoming] = await db.query(
    `
    SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvps
    FROM events e WHERE e.org_id = ? AND ${UPCOMING}
    ORDER BY e.event_date, e.event_time LIMIT 5`,
    [org.id],
  );
  const featured = upcoming[0] || null;
  let going = [];
  if (featured) {
    [going] = await db.query(
      'SELECT u.full_name FROM rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? LIMIT 3',
      [featured.id],
    );
  }

  const now = new Date();
  const hour = now.getHours();
  let greeting = 'Good evening';
  if (hour < 12) {
    greeting = 'Good morning';
  } else if (hour < 18) {
    greeting = 'Good afternoon';
  }

  res.render('admin/overview', {
    title: 'Overview',
    active: 'overview',
    stats: await orgStats(org),
    recent,
    featured,
    upcoming,
    going,
    goingCount: featured ? featured.rsvps : 0,
    greeting,
    today: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    firstName: req.session.user.name.split(' ')[0],
  });
}

/* ---------- Organization profile ---------- */
async function showOrganization(req, res) {
  const [[members]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?', [
    res.locals.org.id,
  ]);
  res.render('admin/organization', {
    title: 'Organization',
    active: 'organization',
    memberCount: members.c,
    categories: CATEGORIES,
    departments: DEPT_NAMES,
  });
}

async function saveOrganization(req, res) {
  const name = text(req.body.name);
  if (!name) {
    flash(req, 'Organization name cannot be empty.', 'err');
    return res.redirect('/admin/organization');
  }

  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Technology';
  /* Eligibility is "International" (any department) or one department */
  const isValidEligibility =
    req.body.eligibility === 'International' || DEPT_NAMES.includes(req.body.eligibility);
  const eligibility = isValidEligibility ? req.body.eligibility : 'International';
  const logo = text(req.body.logo_text, 4) || name.slice(0, 2).toUpperCase();

  await db.query(
    'UPDATE organizations SET name = ?, description = ?, category = ?, tags = ?, eligibility = ?, logo_text = ?, meeting_schedule = ? WHERE id = ?',
    [
      name,
      text(req.body.description),
      category,
      text(req.body.tags, 160),
      eligibility,
      logo,
      text(req.body.meeting_schedule) || 'To be announced',
      res.locals.org.id,
    ],
  );
  flash(req, 'Changes saved. Students can see your updated profile now.');
  res.redirect('/admin/organization');
}

/* ---------- Members ---------- */
async function showMembers(req, res) {
  const q = text(req.query.q);
  const params = [res.locals.org.id];
  let where = '';
  if (q) {
    where = 'AND (u.full_name LIKE ? OR u.email LIKE ? OR m.role_title LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  /* Highest-ranked roles first, then by join date */
  const [members] = await db.query(
    `
    SELECT m.id AS mid, m.role_title, m.joined_at, u.full_name, u.email
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN org_roles o ON o.org_id = m.org_id AND o.role_title = m.role_title
    WHERE m.org_id = ? ${where}
    ORDER BY COALESCE(o.precedence, 999), m.joined_at`,
    params,
  );
  res.render('admin/members', {
    title: 'Members',
    active: 'members',
    members,
    q,
    roles: res.locals.orgRoles,
  });
}

/* Add an existing student account straight to the organization */
async function inviteMember(req, res) {
  const { org, orgRoles } = res.locals;
  const email = cleanEmail(req.body.email);

  const [[student]] = await db.query(
    "SELECT id, full_name FROM users WHERE email = ? AND role = 'student'",
    [email],
  );
  if (!student) {
    flash(req, 'No student account uses that email yet. Ask them to sign up first.', 'err');
    return res.redirect('/admin/members');
  }

  const added = await addMember(org.id, student.id, defaultMemberRole(orgRoles));
  if (!added) {
    flash(req, `${student.full_name} is already a member.`, 'err');
    return res.redirect('/admin/members');
  }

  await notifyUser(student.id, `You were added to ${org.name}. Welcome!`);
  flash(req, `${student.full_name} joined ${org.name}.`);
  res.redirect('/admin/members');
}

async function changeMemberRole(req, res) {
  const validTitles = res.locals.orgRoles.map((r) => r.role_title);
  if (validTitles.includes(req.body.role)) {
    await db.query('UPDATE memberships SET role_title = ? WHERE id = ? AND org_id = ?', [
      req.body.role,
      req.params.mid,
      res.locals.org.id,
    ]);
    flash(req, 'Role updated.');
  }
  res.redirect('/admin/members');
}

async function removeMember(req, res) {
  await db.query('DELETE FROM memberships WHERE id = ? AND org_id = ?', [
    req.params.mid,
    res.locals.org.id,
  ]);
  flash(req, 'Member removed.');
  res.redirect('/admin/members');
}

/* ---------- Officer hierarchy ---------- */
/* Lower precedence = higher rank (1 is the top role). */

async function showOfficers(req, res) {
  const [usage] = await db.query(
    `
    SELECT o.role_title, COUNT(m.id) AS n
    FROM org_roles o LEFT JOIN memberships m ON m.org_id = o.org_id AND m.role_title = o.role_title
    WHERE o.org_id = ? GROUP BY o.id`,
    [res.locals.org.id],
  );

  /* How many members hold each role, by title */
  const useCount = {};
  for (const row of usage) {
    useCount[row.role_title] = Number(row.n);
  }
  res.render('admin/officers', {
    title: 'Officers',
    active: 'officers',
    roles: res.locals.orgRoles,
    useCount,
  });
}

/* Each action returns the flash message to show: [text, type] */

/* Swap a role's precedence with its neighbour above or below */
async function moveRole(orgId, roles, body) {
  const role = roles.find((r) => r.id === Number(body.role_id));
  if (!role) {
    return ['Role not found.', 'err'];
  }

  const step = body.dir === 'up' ? -1 : 1;
  const neighbour = roles.find((r) => r.precedence === role.precedence + step);
  if (!neighbour) {
    return ['Cannot move further.', 'err'];
  }

  const setPrecedence = 'UPDATE org_roles SET precedence = ? WHERE id = ? AND org_id = ?';
  await db.query(setPrecedence, [neighbour.precedence, role.id, orgId]);
  await db.query(setPrecedence, [role.precedence, neighbour.id, orgId]);
  return [`Role “${role.role_title}” moved ${body.dir}.`, 'ok'];
}

/* Add a new officer role at the bottom of the ranking */
async function addRole(orgId, roles, body) {
  const title = text(body.role_title);
  if (!title) {
    return ['Role title cannot be empty.', 'err'];
  }
  if (roles.some((r) => r.role_title === title)) {
    return ['That role already exists.', 'err'];
  }

  const nextPrecedence = Math.max(0, ...roles.map((r) => r.precedence)) + 1;
  await db.query(
    'INSERT INTO org_roles (org_id, role_title, precedence, is_officer) VALUES (?,?,?,1)',
    [orgId, title, nextPrecedence],
  );
  return [`Role “${title}” added.`, 'ok'];
}

/* Remove a role, unless it is the last one or members still hold it */
async function removeRole(orgId, roles, body) {
  const role = roles.find((r) => r.id === Number(body.role_id));
  if (!role) {
    return ['Role not found.', 'err'];
  }
  if (roles.length <= 1) {
    return ['Keep at least one role.', 'err'];
  }

  const [[holders]] = await db.query(
    'SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role_title = ?',
    [orgId, role.role_title],
  );
  if (Number(holders.n) > 0) {
    return [`Cannot remove “${role.role_title}”: ${holders.n} member(s) currently hold it.`, 'err'];
  }

  await db.query('DELETE FROM org_roles WHERE id = ? AND org_id = ?', [role.id, orgId]);
  return [`Role “${role.role_title}” removed.`, 'ok'];
}

const ROLE_ACTIONS = { reorder: moveRole, add: addRole, remove: removeRole };

async function changeOfficers(req, res) {
  const action = ROLE_ACTIONS[req.body.action];
  if (action) {
    const [message, type] = await action(res.locals.org.id, res.locals.orgRoles, req.body);
    flash(req, message, type);
  }
  res.redirect('/admin/officers');
}

/* ---------- Applications ---------- */
async function showApplications(req, res) {
  const [apps] = await db.query(
    `
    SELECT a.*, u.full_name, u.student_id, u.program, u.year_level
    FROM applications a JOIN users u ON u.id = a.user_id
    WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC`,
    [res.locals.org.id],
  );
  res.render('admin/applications', { title: 'Applications', active: 'applications', apps });
}

/* Approve (adds the student as a member) or decline a pending application */
async function reviewApplication(req, res) {
  const { id, action } = req.params;
  const { org, orgRoles } = res.locals;
  const back = '/admin/applications';

  if (!['approve', 'decline'].includes(action)) {
    return res.redirect(back);
  }
  const [[app]] = await db.query('SELECT * FROM applications WHERE id = ? AND org_id = ?', [
    id,
    org.id,
  ]);
  if (!app || app.status !== 'pending') {
    return res.redirect(back);
  }

  const approved = action === 'approve';
  await db.query('UPDATE applications SET status = ?, reviewed_at = NOW() WHERE id = ?', [
    approved ? 'approved' : 'rejected',
    id,
  ]);

  if (approved) {
    await addMember(org.id, app.user_id, defaultMemberRole(orgRoles));
    await notifyUser(app.user_id, `${org.name} accepted your application. Welcome aboard!`);
    flash(req, 'Application approved. They are now a member.');
  } else {
    await notifyUser(
      app.user_id,
      `${org.name} declined your application. You can revise it and apply again.`,
    );
    flash(req, 'Application declined.');
  }
  res.redirect(back);
}

/* ---------- Events ---------- */
async function showEvents(req, res) {
  const [events] = await db.query(
    `
    SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvps
    FROM events e WHERE e.org_id = ? ORDER BY e.event_date, e.event_time`,
    [res.locals.org.id],
  );
  res.render('admin/events', { title: 'Events', active: 'events', events });
}

/* Clean the event form. Returns null when title, date or time is missing or malformed. */
function readEvent(body) {
  const event = {
    title: text(body.title),
    date: String(body.event_date || ''),
    time: String(body.event_time || ''),
    location: text(body.location) || 'TBA',
    description: text(body.description),
    status: body.status === 'published' ? 'published' : 'draft',
  };
  const isValid =
    event.title && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && /^\d{2}:\d{2}/.test(event.time);
  return isValid ? event : null;
}

/* Tell every member about a newly published event */
async function notifyMembers(org, title) {
  await db.query(
    'INSERT INTO notifications (user_id, message) SELECT user_id, ? FROM memberships WHERE org_id = ?',
    [`New event from ${org.name}: ${title}`, org.id],
  );
}

async function createEvent(req, res) {
  const event = readEvent(req.body);
  if (!event) {
    flash(req, 'Add a title, date and time to create the event.', 'err');
    return res.redirect('/admin/events');
  }

  await db.query(
    'INSERT INTO events (org_id, title, event_date, event_time, location, description, status) VALUES (?,?,?,?,?,?,?)',
    [
      res.locals.org.id,
      event.title,
      event.date,
      event.time,
      event.location,
      event.description,
      event.status,
    ],
  );

  if (event.status === 'published') {
    await notifyMembers(res.locals.org, event.title);
    flash(req, 'Event published. Members were notified.');
  } else {
    flash(req, 'Draft saved.');
  }
  res.redirect('/admin/events');
}

async function updateEvent(req, res) {
  const event = readEvent(req.body);
  if (!event) {
    flash(req, 'Add a title, date and time to save the event.', 'err');
    return res.redirect('/admin/events');
  }

  const [[existing]] = await db.query('SELECT status FROM events WHERE id = ? AND org_id = ?', [
    req.params.id,
    res.locals.org.id,
  ]);
  if (!existing) {
    return res.redirect('/admin/events');
  }

  await db.query(
    'UPDATE events SET title = ?, event_date = ?, event_time = ?, location = ?, description = ?, status = ? WHERE id = ?',
    [
      event.title,
      event.date,
      event.time,
      event.location,
      event.description,
      event.status,
      req.params.id,
    ],
  );

  /* Members are only notified the first time an event is published */
  if (existing.status !== 'published' && event.status === 'published') {
    await notifyMembers(res.locals.org, event.title);
  }
  flash(req, 'Event saved.');
  res.redirect('/admin/events');
}

async function deleteEvent(req, res) {
  await db.query('DELETE FROM events WHERE id = ? AND org_id = ?', [
    req.params.id,
    res.locals.org.id,
  ]);
  flash(req, 'Event deleted.');
  res.redirect('/admin/events');
}

/* ---------- Reports ---------- */
async function showReports(req, res) {
  const months = await memberGrowth(res.locals.org.id);
  res.render('admin/reports', {
    title: 'Reports',
    active: 'reports',
    stats: await orgStats(res.locals.org),
    months,
    max: Math.max(1, ...months.map((m) => m.count)),
  });
}

/* Download the same numbers as a CSV file */
async function exportReport(req, res) {
  const org = res.locals.org;
  const stats = await orgStats(org);
  const months = await memberGrowth(org.id);

  const lines = [
    `Report for ${org.name}`,
    '',
    'Metric,Value',
    `Total members,${stats.members}`,
    `Pending applications,${stats.pending}`,
    `Upcoming events,${stats.upcoming}`,
    `Application acceptance %,${stats.acceptance}`,
    `Event attendance %,${stats.attendance}`,
    `Member satisfaction,${org.satisfaction}`,
    '',
    'Month,New members',
    ...months.map((m) => `${m.label},${m.count}`),
  ];

  const fileName = org.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}-report.csv"`);
  res.send(lines.join('\n'));
}

/* ---------- Routes ---------- */
router.use(requireRole('adviser'));
router.use(wrap(loadOrganization));
router.get('/', wrap(showOverview));
router.get('/organization', wrap(showOrganization));
router.post('/organization', wrap(saveOrganization));
router.get('/members', wrap(showMembers));
router.post('/members/invite', wrap(inviteMember));
router.post('/members/:mid/role', wrap(changeMemberRole));
router.post('/members/:mid/remove', wrap(removeMember));
router.get('/officers', wrap(showOfficers));
router.post('/officers', wrap(changeOfficers));
router.get('/applications', wrap(showApplications));
router.post('/applications/:id/:action', wrap(reviewApplication));
router.get('/events', wrap(showEvents));
router.post('/events', wrap(createEvent));
router.post('/events/:id', wrap(updateEvent));
router.post('/events/:id/delete', wrap(deleteEvent));
router.get('/reports', wrap(showReports));
router.get('/reports/export', wrap(exportReport));

module.exports = router;
