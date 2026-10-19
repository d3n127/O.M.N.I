// Run once:  npm run setup
// Creates the database, all tables and demo data. WARNING: it resets the database.
const mysql = require('mysql2/promise');
const cfg = require('./conn');
cfg.on('error', () => {}); // expected on a fresh machine: fourloop_db doesn't exist yet (created below)
const { hashPassword, ymd } = require('./utils');

const SCHEMA = `
CREATE TABLE organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'Technology',
  tags VARCHAR(160) NOT NULL DEFAULT '',
  color ENUM('yellow','teal','lime','lilac') NOT NULL DEFAULT 'teal',
  logo_text VARCHAR(4) NOT NULL DEFAULT 'OR',
  logo_style ENUM('tile','navy','cream','dark') NOT NULL DEFAULT 'dark',
  meeting_schedule VARCHAR(120) NOT NULL DEFAULT 'To be announced',
  satisfaction DECIMAL(2,1) NOT NULL DEFAULT 4.5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  role ENUM('student','admin') NOT NULL,
  program VARCHAR(100) NOT NULL DEFAULT 'Undeclared',
  year_level TINYINT NOT NULL DEFAULT 1,
  org_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_role (email, role),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL
);
CREATE TABLE memberships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  user_id INT NOT NULL,
  role_title VARCHAR(40) NOT NULL DEFAULT 'Member',
  joined_at DATE NOT NULL,
  UNIQUE KEY uq_member (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  user_id INT NOT NULL,
  intro TEXT,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  UNIQUE KEY uq_app (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  title VARCHAR(140) NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME NOT NULL,
  location VARCHAR(140) NOT NULL DEFAULT 'TBA',
  description TEXT,
  status ENUM('draft','published') NOT NULL DEFAULT 'draft',
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE TABLE rsvps (
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE bookmarks (
  user_id INT NOT NULL,
  org_id INT NOT NULL,
  PRIMARY KEY (user_id, org_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message VARCHAR(255) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`;

const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

(async () => {
  const c = await mysql.createConnection({ host: cfg.config.host, user: cfg.config.user, password: cfg.config.password, multipleStatements: true });
  const db = `\`${cfg.config.database}\``;
  await c.query(`DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} CHARACTER SET utf8mb4; USE ${db};`);
  await c.query(SCHEMA);

  const ins = async (sql, p) => (await c.query(sql, p))[0].insertId;
  const pw = hashPassword('password');

  /* organizations */
  const O = {};
  const orgs = [
    ['F1 Stackmind', 'Build fast, think strategically, and turn ambitious ideas into working products.', 'Technology', 'Innovation,Technology', 'yellow', 'F1', 'tile', 'Every Wednesday · 5:30 PM'],
    ['CITEMAS', 'Bring stories to life through animation, motion, and collaborative visual projects.', 'Creative', 'Animation,Creative', 'teal', 'CT', 'navy', 'Every Tuesday · 4:00 PM'],
    ['UIPC', 'A welcoming community for every kind of coder, from first program to full stack.', 'Technology', 'All code,Community', 'lime', '</>', 'cream', 'Every Thursday · 6:00 PM'],
    ['Xcite', 'Move with confidence, learn new styles, and perform with the campus dance community.', 'Creative', 'Dance,Performance', 'lilac', 'XC', 'dark', 'Every Friday · 5:00 PM']
  ];
  for (const o of orgs) {
    O[o[0]] = await ins('INSERT INTO organizations (name,description,category,tags,color,logo_text,logo_style,meeting_schedule) VALUES (?,?,?,?,?,?,?,?)', o);
  }
  await c.query('UPDATE organizations SET satisfaction = 4.8 WHERE id = ?', [O.UIPC]);

  /* users */
  const user = (name, email, program, year, role = 'student', org = null) =>
    ins('INSERT INTO users (full_name,email,password_hash,role,program,year_level,org_id) VALUES (?,?,?,?,?,?,?)', [name, email, pw, role, program, year, org]);

  const maya = await user('Maya Alvarez', 'maya@north.edu', 'Computer Science', 2);
  const alex = await user('Alex Rivera', 'admin@codecraft.edu', 'Faculty Advisor', 1, 'admin', O.UIPC);

  const core = [
    ['Theo Kim', 'theo@north.edu', 'Information Systems', 3, 'President', '2023-10-05'],
    ['Morgan Liu', 'morgan@north.edu', 'Computer Science', 3, 'Vice President', '2024-01-12'],
    ['Eli Parker', 'eli@north.edu', 'Software Engineering', 2, 'Events Lead', '2024-02-09'],
    ['Ravi Nair', 'ravi@north.edu', 'Computer Science', 2, 'Member', '2024-09-04'],
    ['Chloe Martin', 'chloe@north.edu', 'Data Science', 2, 'Member', '2024-09-18']
  ];
  const theoId = {};
  for (const m of core) {
    const id = await user(m[0], m[1], m[2], m[3]);
    if (m[0] === 'Theo Kim') theoId.id = id;
    await c.query('INSERT INTO memberships (org_id,user_id,role_title,joined_at) VALUES (?,?,?,?)', [O.UIPC, id, m[4], m[5]]);
  }

  /* applicants for UIPC (pending) */
  const quote = "I'd love to build practical projects and meet people who are excited about technology.";
  const applicants = [
    ['Jordan Lee', 'jordan@north.edu', 'Computer Science', 2, 4, quote],
    ['Amara Nwosu', 'amara@north.edu', 'Digital Media', 1, 3, 'I want to learn web development and ship a real project with a team.'],
    ['Sofia Reyes', 'sofia@north.edu', 'Data Science', 2, 1, 'Looking for a place to practice Python and meet people who enjoy debugging together.']
  ];
  for (const a of applicants) {
    const id = await user(a[0], a[1], a[2], a[3]);
    await c.query('INSERT INTO applications (org_id,user_id,intro,status,created_at) VALUES (?,?,?,?,?)', [O.UIPC, id, a[5], 'pending', `${addDays(-a[4])} 10:00:00`]);
  }
  await c.query('INSERT INTO applications (org_id,user_id,intro,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?)',
    [O.UIPC, theoId.id, quote, 'approved', '2023-10-01 10:00:00', '2023-10-02 10:00:00']);

  /* filler students so the reports have real numbers */
  const first = ['Ana', 'Ben', 'Cleo', 'Dev', 'Ella', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jules'];
  const last = ['Santos', 'Park', 'Okafor'];
  const filler = [];
  for (const l of last) for (const f of first) {
    filler.push(await user(`${f} ${l}`, `${f}.${l}@north.edu`.toLowerCase(), 'Undeclared', 1 + (filler.length % 4)));
  }
  const now = new Date();
  const monthsAgo = [];
  [[5, 2], [4, 3], [3, 2], [2, 4], [1, 5], [0, 7]].forEach(([m, n]) => { for (let i = 0; i < n; i++) monthsAgo.push(m); });
  for (let i = 0; i < filler.length; i++) {
    let org, joined;
    if (i < 23) { org = O.UIPC; joined = ymd(new Date(now.getFullYear(), now.getMonth() - monthsAgo[i], 10)); }
    else { org = i < 26 ? O['F1 Stackmind'] : i < 28 ? O.CITEMAS : O.Xcite; joined = addDays(-(i * 3)); }
    await c.query('INSERT INTO memberships (org_id,user_id,role_title,joined_at) VALUES (?,?,?,?)', [org, filler[i], 'Member', joined]);
  }

  /* Maya: member of Xcite + CITEMAS, pending at F1 Stackmind */
  await c.query('INSERT INTO memberships (org_id,user_id,role_title,joined_at) VALUES (?,?,?,?)', [O.Xcite, maya, 'Member', addDays(-14)]);
  await c.query('INSERT INTO memberships (org_id,user_id,role_title,joined_at) VALUES (?,?,?,?)', [O.CITEMAS, maya, 'Member', addDays(-3)]);
  await c.query('INSERT INTO applications (org_id,user_id,intro,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?)',
    [O.Xcite, maya, 'I have always loved dancing and want to perform with a team.', 'approved', `${addDays(-16)} 09:00:00`, `${addDays(-14)} 09:00:00`]);
  await c.query('INSERT INTO applications (org_id,user_id,intro,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?)',
    [O.CITEMAS, maya, 'I want to learn 2D animation and collaborate on short films.', 'approved', `${addDays(-4)} 09:00:00`, `${addDays(-3)} 09:00:00`]);
  await c.query('INSERT INTO applications (org_id,user_id,intro,status,created_at) VALUES (?,?,?,?,?)',
    [O['F1 Stackmind'], maya, 'I want to build a product with a fast-moving team.', 'pending', `${addDays(0)} 08:30:00`]);
  await c.query('INSERT INTO bookmarks (user_id,org_id) VALUES (?,?)', [maya, O.CITEMAS]);

  /* events */
  const ev = (org, title, day, time, place, status, desc) =>
    ins('INSERT INTO events (org_id,title,event_date,event_time,location,status,description) VALUES (?,?,?,?,?,?,?)', [org, title, addDays(day), time, place, status, desc]);
  await ev(O['F1 Stackmind'], 'Hackathon', 2, '09:00', 'Innovation Lab', 'published', '24 hours of building. Bring a team or find one on the day.');
  const debugging = await ev(O.UIPC, 'Debugging', 3, '14:00', 'Computer Lab 2', 'published', 'Bring your broken code and fix it together.');
  await ev(O.UIPC, 'Open Source Sprint', 4, '14:00', 'Computer Lab 2', 'draft', 'Make your first open source contribution.');
  await ev(O.Xcite, 'Open Floor Workshop', 5, '17:00', 'Gym Hall', 'published', 'Learn a new style and perform at the end.');
  await ev(O.CITEMAS, 'Animation Jam', 6, '16:00', 'Media Room', 'published', 'Make a 10-second loop in one afternoon.');
  for (let i = 0; i < 12; i++) await c.query('INSERT INTO rsvps (event_id,user_id) VALUES (?,?)', [debugging, filler[i]]);

  /* notifications */
  await c.query('INSERT INTO notifications (user_id,message,is_read) VALUES (?,?,0)', [maya, 'CITEMAS accepted your application. Welcome aboard!']);
  await c.query('INSERT INTO notifications (user_id,message,is_read) VALUES (?,?,1)', [maya, 'New event from UIPC: Debugging']);
  await c.query('INSERT INTO notifications (user_id,message,is_read) VALUES (?,?,0)', [alex, 'Jordan Lee applied to join UIPC.']);
  await c.query('INSERT INTO notifications (user_id,message,is_read) VALUES (?,?,0)', [alex, 'Amara Nwosu applied to join UIPC.']);

  await c.end();
  cfg.destroy(); // release the connection conn.js opened, so this script can exit
  console.log('\nDatabase "%s" is ready.\n  Student:  maya@north.edu / password\n  Admin:    admin@codecraft.edu / password (UIPC)\n', cfg.config.database);
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
