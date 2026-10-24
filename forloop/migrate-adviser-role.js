// Run once: node migrate-adviser-role.js
// Idempotent migration for unified auth: role 'admin' -> 'adviser' + email unique across roles.
const db = require('./conn').promise();

/* Renaming an ENUM value in place is implicit (MySQL falls back to positional
   conversion), so do it explicitly: widen -> update rows -> narrow. Safe to re-run. */
const WIDEN  = "ALTER TABLE users MODIFY role ENUM('student','admin','adviser') NOT NULL";
const NARROW = "ALTER TABLE users MODIFY role ENUM('student','adviser') NOT NULL";

/* errno 1091 = index not there (already dropped); 1061 = key name already exists (already added) */
async function run(sql, ignoreErrnos = []) {
  try { await db.query(sql); console.log('OK  :', sql.slice(0, 70) + '...'); }
  catch (e) {
    if (ignoreErrnos.includes(e.errno)) console.log('SKIP:', sql.slice(0, 70) + '... (already applied)');
    else throw e;
  }
}

(async () => {
  await run(WIDEN);
  const [r] = await db.query("UPDATE users SET role = 'adviser' WHERE role = 'admin'");
  console.log(`OK  : ${r.affectedRows} account(s) admin -> adviser`);
  await run(NARROW);

  /* Unified login looks the account up by email alone, so one email may map to
     exactly one account across every role. Only tighten the index when no
     duplicate emails exist — otherwise the ALTER would fail. */
  const [dupes] = await db.query('SELECT email, COUNT(*) AS c FROM users GROUP BY email HAVING c > 1');
  if (dupes.length) {
    console.log('WARN: duplicate emails must be resolved before the unique index can be added:');
    console.log('      ' + JSON.stringify(dupes));
  } else {
    await run('ALTER TABLE users DROP INDEX uq_email_role', [1091]);
    await run('ALTER TABLE users ADD UNIQUE KEY uq_email (email)', [1061]);
  }

  const [roles] = await db.query('SELECT role, COUNT(*) AS c FROM users GROUP BY role');
  const [idx] = await db.query("SHOW INDEX FROM users WHERE Key_name IN ('uq_email','uq_email_role')");
  console.log('Roles:', JSON.stringify(roles));
  console.log('Email index:', JSON.stringify(idx.map((i) => i.Key_name)));
  console.log('migration done');
  process.exit(0);
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
