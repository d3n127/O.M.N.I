const db = require('../conn').promise();

/* Shared application body of FR-STUDENT-3 and FR-NONMEMBER-3 — one implementation so both
   portals validate and write identically (divergence is a defect, spec-nonmember §5). */
async function applyToOrg(req, res) {
  /* RBAC asserted here as well as in the router: applying is a student-only action,
     so the helper stays safe even if it is ever mounted outside requireRole('student'). */
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'Sign in to continue.' });
  if (u.role !== 'student') return res.status(403).json({ error: 'Only student accounts can apply to an organization.' });
  const uid = u.id;
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
  await db.query("INSERT INTO notifications (user_id, message) SELECT id, ? FROM users WHERE role = 'adviser' AND org_id = ?",
    [`${req.session.user.name} applied to join ${org.name}.`, orgId]);
  res.json({ ok: true, name: org.name });
}

module.exports = { applyToOrg };
