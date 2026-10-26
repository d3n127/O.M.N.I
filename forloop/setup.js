// Run once:  npm run setup
// Creates the database, tables and demo data. WARNING: resets the database.
const mysql = require('mysql2/promise');
const cfg = require('./conn');
cfg.on('error', () => {}); // Expected on a fresh machine
const { hashPassword, ymd } = require('./utils');

const SCHEMA = `
CREATE TABLE organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'Technology',
  tags VARCHAR(160) NOT NULL DEFAULT '',
  eligibility VARCHAR(100) NOT NULL DEFAULT 'International',
  color ENUM('yellow','teal','lime','lilac') NOT NULL DEFAULT 'teal',
  logo_text VARCHAR(4) NOT NULL DEFAULT 'OR',
  logo_style ENUM('tile','navy','cream','dark') NOT NULL DEFAULT 'dark',
  meeting_schedule VARCHAR(120) NOT NULL DEFAULT 'To be announced',
  satisfaction DECIMAL(2,1) NOT NULL DEFAULT 4.5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
/* Per-org officer roles; lower precedence = higher rank. */
CREATE TABLE org_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  role_title VARCHAR(40) NOT NULL,
  precedence INT NOT NULL DEFAULT 0,
  is_officer TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_org_role (org_id, role_title),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  role ENUM('student','adviser') NOT NULL,
  student_id VARCHAR(24) NULL,
  program VARCHAR(100) NOT NULL DEFAULT 'Undeclared',
  year_level TINYINT NOT NULL DEFAULT 1,
  contact VARCHAR(30) NULL,
  college VARCHAR(100) NULL,
  bio VARCHAR(300) NULL,
  hobbies VARCHAR(300) NULL,
  profile_complete TINYINT(1) NOT NULL DEFAULT 0,
  org_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email),
  UNIQUE KEY uq_student_id (student_id),
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

/* ---------- Helpers ---------- */

/* Date `n` days from today as "YYYY-MM-DD" (negative = in the past). */
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/* [role title, precedence (1 = top rank), is officer] given to every organization */
const DEFAULT_ROLES = [
  ['President', 1, 1],
  ['Vice President', 2, 1],
  ['Events Lead', 3, 1],
  ['Treasurer', 4, 1],
  ['Secretary', 5, 1],
  ['Member', 6, 0],
];

const ORGANIZATIONS = [
  {
    name: 'F1 Stackmind',
    description: 'Build fast, think strategically, and turn ambitious ideas into working products.',
    category: 'Technology',
    tags: 'Innovation,Technology',
    color: 'yellow',
    logo: 'F1',
    style: 'tile',
    schedule: 'Every Wednesday · 5:30 PM',
    eligibility: 'College of Engineering',
  },
  {
    name: 'CITEMAS',
    description: 'Bring stories to life through animation, motion, and collaborative visual projects.',
    category: 'Creative',
    tags: 'Animation,Creative',
    color: 'teal',
    logo: 'CT',
    style: 'navy',
    schedule: 'Every Tuesday · 4:00 PM',
    eligibility: 'College of Arts & Sciences',
  },
  {
    name: 'UIPC',
    description: 'A welcoming community for every kind of coder, from first program to full stack.',
    category: 'Technology',
    tags: 'All code,Community',
    color: 'lime',
    logo: '</>',
    style: 'cream',
    schedule: 'Every Thursday · 6:00 PM',
    eligibility: 'International', // International = open to any department
    satisfaction: 4.8,
  },
  {
    name: 'Xcite',
    description: 'Move with confidence, learn new styles, and perform with the campus dance community.',
    category: 'Creative',
    tags: 'Dance,Performance',
    color: 'lilac',
    logo: 'XC',
    style: 'dark',
    schedule: 'Every Friday · 5:00 PM',
    eligibility: 'International',
  },
];

const JOIN_QUOTE =
  "I'd love to build practical projects and meet people who are excited about technology.";

/* ---------- Seed ---------- */

async function seed() {
  const conn = await mysql.createConnection({
    host: cfg.config.host,
    user: cfg.config.user,
    password: cfg.config.password,
    multipleStatements: true,
  });
  const database = `\`${cfg.config.database}\``;
  await conn.query(
    `DROP DATABASE IF EXISTS ${database}; CREATE DATABASE ${database} CHARACTER SET utf8mb4; USE ${database};`,
  );
  await conn.query(SCHEMA);

  /* Each helper inserts one row and (where useful) returns its new id. */
  const insert = async (sql, params) => (await conn.query(sql, params))[0].insertId;

  const addOrg = (o) =>
    insert(
      'INSERT INTO organizations (name,description,category,tags,eligibility,color,logo_text,logo_style,meeting_schedule,satisfaction) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        o.name,
        o.description,
        o.category,
        o.tags,
        o.eligibility,
        o.color,
        o.logo,
        o.style,
        o.schedule,
        o.satisfaction || 4.5,
      ],
    );

  /* Every user gets its own password salt; all demo passwords are "password". */
  const addUser = async (name, email, program, year, role = 'student', orgId = null) =>
    insert(
      'INSERT INTO users (full_name,email,password_hash,role,program,year_level,org_id) VALUES (?,?,?,?,?,?,?)',
      [name, email, await hashPassword('password'), role, program, year, orgId],
    );

  const addMember = (orgId, userId, roleTitle, joinedAt) =>
    conn.query('INSERT INTO memberships (org_id,user_id,role_title,joined_at) VALUES (?,?,?,?)', [
      orgId,
      userId,
      roleTitle,
      joinedAt,
    ]);

  /* `reviewedAt` is null for pending applications */
  const addApplication = (orgId, userId, intro, status, createdAt, reviewedAt = null) =>
    conn.query(
      'INSERT INTO applications (org_id,user_id,intro,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?)',
      [orgId, userId, intro, status, createdAt, reviewedAt],
    );

  const addEvent = (orgId, title, inDays, time, place, status, description) =>
    insert(
      'INSERT INTO events (org_id,title,event_date,event_time,location,status,description) VALUES (?,?,?,?,?,?,?)',
      [orgId, title, addDays(inDays), time, place, status, description],
    );

  const addNotification = (userId, message, isRead) =>
    conn.query('INSERT INTO notifications (user_id,message,is_read) VALUES (?,?,?)', [
      userId,
      message,
      isRead,
    ]);

  /* ----- Organizations and their officer roles ----- */
  const orgId = {};
  for (const org of ORGANIZATIONS) {
    orgId[org.name] = await addOrg(org);
    for (const [title, precedence, isOfficer] of DEFAULT_ROLES) {
      await conn.query(
        'INSERT INTO org_roles (org_id, role_title, precedence, is_officer) VALUES (?,?,?,?)',
        [orgId[org.name], title, precedence, isOfficer],
      );
    }
  }
  const { UIPC, CITEMAS, Xcite } = orgId;
  const F1 = orgId['F1 Stackmind'];

  /* ----- Main demo accounts ----- */
  const maya = await addUser('Maya Alvarez', 'maya@north.edu', 'BS Computer Science', 2);
  const alex = await addUser(
    'Alex Rivera',
    'admin@codecraft.edu',
    'Faculty Advisor',
    1,
    'adviser',
    UIPC,
  );

  /* ----- UIPC officers and early members ----- */
  const core = [
    ['Theo Kim', 'theo@north.edu', 'BS Information Systems', 3, 'President', '2023-10-05'],
    ['Morgan Liu', 'morgan@north.edu', 'BS Computer Science', 3, 'Vice President', '2024-01-12'],
    ['Eli Parker', 'eli@north.edu', 'BS Software Engineering', 2, 'Events Lead', '2024-02-09'],
    ['Ravi Nair', 'ravi@north.edu', 'BS Computer Science', 2, 'Member', '2024-09-04'],
    ['Chloe Martin', 'chloe@north.edu', 'BS Data Science', 2, 'Member', '2024-09-18'],
  ];
  let theo;
  for (const [name, email, program, year, roleTitle, joinedAt] of core) {
    const id = await addUser(name, email, program, year);
    if (name === 'Theo Kim') {
      theo = id;
    }
    await addMember(UIPC, id, roleTitle, joinedAt);
  }

  /* ----- UIPC applicants waiting for review ----- */
  const applicants = [
    ['Jordan Lee', 'jordan@north.edu', 'BS Computer Science', 2, 4, JOIN_QUOTE],
    [
      'Amara Nwosu',
      'amara@north.edu',
      'BS Information Technology',
      1,
      3,
      'I want to learn web development and ship a real project with a team.',
    ],
    [
      'Sofia Reyes',
      'sofia@north.edu',
      'BS Data Science',
      2,
      1,
      'Looking for a place to practice Python and meet people who enjoy debugging together.',
    ],
  ];
  for (const [name, email, program, year, daysAgo, intro] of applicants) {
    const id = await addUser(name, email, program, year);
    await addApplication(UIPC, id, intro, 'pending', `${addDays(-daysAgo)} 10:00:00`);
  }
  await addApplication(
    UIPC,
    theo,
    JOIN_QUOTE,
    'approved',
    '2023-10-01 10:00:00',
    '2023-10-02 10:00:00',
  );

  /* ----- 30 filler students, so Reports has data to show ----- */
  const firstNames = ['Ana', 'Ben', 'Cleo', 'Dev', 'Ella', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jules'];
  const lastNames = ['Santos', 'Park', 'Okafor'];
  const filler = [];
  for (const last of lastNames) {
    for (const first of firstNames) {
      const email = `${first}.${last}@north.edu`.toLowerCase();
      filler.push(await addUser(`${first} ${last}`, email, 'Undeclared', 1 + (filler.length % 4)));
    }
  }

  /* The first 23 fillers join UIPC, spread over the last 6 months: [months ago, how many] */
  const joinSchedule = [
    [5, 2],
    [4, 3],
    [3, 2],
    [2, 4],
    [1, 5],
    [0, 7],
  ];
  const monthsAgo = joinSchedule.flatMap(([months, count]) => Array(count).fill(months));
  const now = new Date();

  for (let i = 0; i < filler.length; i++) {
    if (i < 23) {
      const joined = ymd(new Date(now.getFullYear(), now.getMonth() - monthsAgo[i], 10));
      await addMember(UIPC, filler[i], 'Member', joined);
    } else {
      const org = i < 26 ? F1 : i < 28 ? CITEMAS : Xcite;
      await addMember(org, filler[i], 'Member', addDays(-(i * 3)));
    }
  }

  /* ----- Maya: member of Xcite and CITEMAS, pending at F1 Stackmind ----- */
  await conn.query('UPDATE users SET hobbies = ? WHERE id = ?', ['Dancing, Animation, Chess', maya]);
  await addMember(Xcite, maya, 'Member', addDays(-14));
  await addMember(CITEMAS, maya, 'Member', addDays(-3));
  await addApplication(
    Xcite,
    maya,
    'I have always loved dancing and want to perform with a team.',
    'approved',
    `${addDays(-16)} 09:00:00`,
    `${addDays(-14)} 09:00:00`,
  );
  await addApplication(
    CITEMAS,
    maya,
    'I want to learn 2D animation and collaborate on short films.',
    'approved',
    `${addDays(-4)} 09:00:00`,
    `${addDays(-3)} 09:00:00`,
  );
  await addApplication(
    F1,
    maya,
    'I want to build a product with a fast-moving team.',
    'pending',
    `${addDays(0)} 08:30:00`,
  );
  await conn.query('INSERT INTO bookmarks (user_id,org_id) VALUES (?,?)', [maya, CITEMAS]);

  /* ----- Events (the day argument is "days from today") ----- */
  await addEvent(
    F1,
    'Hackathon',
    2,
    '09:00',
    'Innovation Lab',
    'published',
    '24 hours of building. Bring a team or find one on the day.',
  );
  const debugging = await addEvent(
    UIPC,
    'Debugging',
    3,
    '14:00',
    'Computer Lab 2',
    'published',
    'Bring your broken code and fix it together.',
  );
  await addEvent(
    UIPC,
    'Open Source Sprint',
    4,
    '14:00',
    'Computer Lab 2',
    'draft',
    'Make your first open source contribution.',
  );
  await addEvent(
    Xcite,
    'Open Floor Workshop',
    5,
    '17:00',
    'Gym Hall',
    'published',
    'Learn a new style and perform at the end.',
  );
  await addEvent(
    CITEMAS,
    'Animation Jam',
    6,
    '16:00',
    'Media Room',
    'published',
    'Make a 10-second loop in one afternoon.',
  );
  for (const student of filler.slice(0, 12)) {
    await conn.query('INSERT INTO rsvps (event_id,user_id) VALUES (?,?)', [debugging, student]);
  }

  /* ----- Notifications ----- */
  await addNotification(maya, 'CITEMAS accepted your application. Welcome aboard!', 0);
  await addNotification(maya, 'New event from UIPC: Debugging', 1);
  await addNotification(alex, 'Jordan Lee applied to join UIPC.', 0);
  await addNotification(alex, 'Amara Nwosu applied to join UIPC.', 0);

  await conn.end();
  cfg.destroy(); // Release the connection
  console.log(
    '\nDatabase "%s" is ready.\n  Student:  maya@north.edu / password\n  Adviser:  admin@codecraft.edu / password (UIPC)\n',
    cfg.config.database,
  );
}

async function main() {
  try {
    await seed();
  } catch (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  }
}

main();
