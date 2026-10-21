// Run once: node migrate-eligibility-hobbies.js
// Idempotent migration for org "who can join" eligibility + user hobbies + department rename.
const db = require('./conn').promise();

const ALTERS = [
  "ALTER TABLE organizations ADD COLUMN eligibility VARCHAR(100) NOT NULL DEFAULT 'International'",
  'ALTER TABLE users ADD COLUMN hobbies VARCHAR(300) NULL'
];

const UPDATES = [
  ["UPDATE organizations SET eligibility = 'College of Engineering' WHERE name = 'F1 Stackmind'", []],
  ["UPDATE organizations SET eligibility = 'College of Arts & Sciences' WHERE name = 'CITEMAS'", []],
  ["UPDATE users SET college = 'College of Information Technology' WHERE college = 'College of Computer Studies'", []],
  ["UPDATE users SET hobbies = 'Dancing, Animation, Chess' WHERE email = 'maya@north.edu' AND (hobbies IS NULL OR hobbies = '')", []]
];

(async () => {
  for (const sql of ALTERS) {
    try { await db.query(sql); console.log('OK  :', sql.slice(0, 60) + '...'); }
    catch (e) {
      if (e.errno === 1060 || e.errno === 1061) console.log('SKIP:', sql.slice(0, 60) + '... (already applied)');
      else throw e;
    }
  }
  for (const [sql, params] of UPDATES) {
    const [r] = await db.query(sql, params);
    console.log(`OK  : affected ${r.affectedRows} — ${sql.slice(0, 60)}...`);
  }
  const [orgs] = await db.query('SELECT name, eligibility FROM organizations ORDER BY id');
  console.log('Orgs :', JSON.stringify(orgs));
  const [depts] = await db.query('SELECT college, COUNT(*) AS c FROM users GROUP BY college');
  console.log('Depts:', JSON.stringify(depts));
  console.log('migration done');
  process.exit(0);
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
