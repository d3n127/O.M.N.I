// Run once: node migrate-org-roles.js
// Idempotent migration: adds the org_roles table (per-organization officer
// hierarchy) and seeds the default 6 roles into every existing organization.
// Safe to re-run: uses INSERT IGNORE so existing default roles are not duplicated.
const db = require('./conn').promise();

const DEFAULT_ROLES = [
  ['President', 1, 1], ['Vice President', 2, 1], ['Events Lead', 3, 1],
  ['Treasurer', 4, 1], ['Secretary', 5, 1], ['Member', 6, 0]
];

(async () => {
  /* Create the table if it does not exist yet. */
  await db.query(`
CREATE TABLE IF NOT EXISTS org_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  role_title VARCHAR(40) NOT NULL,
  precedence INT NOT NULL DEFAULT 0,
  is_officer TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_org_role (org_id, role_title),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
)`);

  /* Seed default roles into every organization that lacks them. */
  const [orgs] = await db.query('SELECT id FROM organizations');
  let seeded = 0;
  for (const { id: orgId } of orgs) {
    for (const [title, prec, officer] of DEFAULT_ROLES) {
      const [r] = await db.query(
        'INSERT IGNORE INTO org_roles (org_id, role_title, precedence, is_officer) VALUES (?,?,?,?)',
        [orgId, title, prec, officer]);
      seeded += r.affectedRows;
    }
  }

  /* Backfill any memberships whose role_title no longer exists in org_roles
     (defensive: should not happen with the default seed, but keeps data sane). */
  const [stray] = await db.query(`
    SELECT m.id FROM memberships m
    LEFT JOIN org_roles o ON o.org_id = m.org_id AND o.role_title = m.role_title
    WHERE o.id IS NULL`);
  if (stray.length) {
    console.log(`WARN: ${stray.length} membership(s) reference a role not in org_roles; leaving them as-is.`);
  }

  console.log(`OK  : org_roles table ready (seeded ${seeded} default role(s)).`);
  console.log('migration done');
  process.exit(0);
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
