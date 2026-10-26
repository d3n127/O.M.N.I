/* Apply-to-organization handler, shared by the student and non-member portals. */
const db = require('../conn').promise();
const { text } = require('../utils');

/* Replies with JSON: { ok: true, name } on success, or { error } with an HTTP error status. */
async function applyToOrg(req, res) {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  if (user.role !== 'student') {
    return res.status(403).json({ error: 'Only student accounts can apply to an organization.' });
  }

  const orgId = Number(req.body.org_id);
  const intro = text(req.body.intro);
  if (!intro) {
    return res
      .status(400)
      .json({ error: 'Write a short introduction so the team can get to know you.' });
  }
  if (!req.body.agree) {
    return res.status(400).json({ error: 'Agree to share your student profile to continue.' });
  }

  const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [orgId]);
  if (!org) {
    return res.status(404).json({ error: 'That organization no longer exists.' });
  }

  const [memberships] = await db.query(
    'SELECT id FROM memberships WHERE org_id = ? AND user_id = ?',
    [orgId, user.id],
  );
  if (memberships.length) {
    return res.status(400).json({ error: `You are already a member of ${org.name}.` });
  }

  /* One application per org. A rejected one can be re-submitted; anything else cannot. */
  const [[existing]] = await db.query(
    'SELECT id, status FROM applications WHERE org_id = ? AND user_id = ?',
    [orgId, user.id],
  );
  if (existing && existing.status !== 'rejected') {
    return res
      .status(400)
      .json({ error: 'You already applied. Check the Applications tab for updates.' });
  }

  if (existing) {
    await db.query(
      "UPDATE applications SET intro = ?, status = 'pending', created_at = NOW(), reviewed_at = NULL WHERE id = ?",
      [intro, existing.id],
    );
  } else {
    await db.query('INSERT INTO applications (org_id, user_id, intro) VALUES (?,?,?)', [
      orgId,
      user.id,
      intro,
    ]);
  }

  /* Tell the organization's adviser(s) */
  await db.query(
    "INSERT INTO notifications (user_id, message) SELECT id, ? FROM users WHERE role = 'adviser' AND org_id = ?",
    [`${user.name} applied to join ${org.name}.`, orgId],
  );
  res.json({ ok: true, name: org.name });
}

module.exports = { applyToOrg };
