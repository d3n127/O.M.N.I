// Run once:  npm run setup
// Creates the database, tables and demo data. WARNING: resets the database.
const mysql = require('mysql2');
const cfg = require('./conn');
cfg.on('error', () => {}); // Expected on a fresh machine
const { hashPassword, ymd, series } = require('./utils');

const SCHEMA = `
CREATE TABLE organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'Technology',
  tags VARCHAR(160) NOT NULL DEFAULT '',
  eligibility VARCHAR(100) NOT NULL DEFAULT 'International',
  color ENUM('yellow','teal','lime','lilac','salmon','sky','rose','sand','black','red','brown','orange','white') NOT NULL DEFAULT 'teal',
  logo_img VARCHAR(120) NOT NULL DEFAULT 'OR',
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
  avatar VARCHAR(120) NULL,
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
  capacity INT NULL,
  attendance_taken TINYINT(1) NOT NULL DEFAULT 0,
  reminder_sent TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
/* Running order of an event: segments with an optional start time and speaker. */
CREATE TABLE event_program (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  start_time TIME NULL,
  title VARCHAR(140) NOT NULL,
  speaker VARCHAR(100) NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
/* seq orders the waitlist; attended is the adviser's check-in. */
CREATE TABLE rsvps (
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  seq INT NOT NULL AUTO_INCREMENT,
  status ENUM('going','waitlist') NOT NULL DEFAULT 'going',
  attended TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id),
  UNIQUE KEY uq_rsvp_seq (seq),
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
);
CREATE TABLE announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  title VARCHAR(140) NOT NULL,
  body TEXT,
  kind ENUM('update','recruitment') NOT NULL DEFAULT 'update',
  closes_on DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
/* Questions an organization asks applicants; answers keep a copy of the question text. */
CREATE TABLE org_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  question VARCHAR(200) NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE TABLE application_answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  question VARCHAR(200) NOT NULL,
  answer TEXT,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);`;

/* ---------- Helpers ---------- */

/* Date `n` days from today as "YYYY-MM-DD" (negative = in the past). */
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/* [role title, precedence (1 = top rank), is officer] given to every organization */
const DEFAULT_ROLES = [
  ['President', 1, 1],
  ['Vice President', 2, 1],
  ['Events Lead', 3, 1],
  ['Treasurer', 4, 1],
  ['Secretary', 5, 1],
  ['Member', 6, 0],
];

/* `key` is the short name used to look up the organization's id while seeding. */
const ORGANIZATIONS = [
  {
    key: 'F1',
    name: 'F1 Stackmind',
    description: 'Build fast, think strategically, and turn ambitious ideas into working products.',
    category: 'Technology',
    tags: 'Innovation,Technology',
    color: 'yellow',
    logo: 'F1',
    style: 'tile',
    img: '/pic/org-logo/f1stackmind.jpg',
    schedule: 'Every Wednesday · 5:30 PM',
    eligibility: 'College of Engineering',
  },
  {
    key: 'CITEMAS',
    name: 'CITEMAS',
    description: 'Bring stories to life through animation, motion, and collaborative visual projects.',
    category: 'Creative',
    tags: 'Animation,Creative',
    color: 'teal',
    logo: 'CT',
    style: 'navy',
    img: '/pic/org-logo/citemas.png',
    schedule: 'Every Tuesday · 4:00 PM',
    eligibility: 'College of Arts & Sciences',
  },
  {
    key: 'UIPC',
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
    key: 'Xcite',
    name: 'Xcite',
    description: 'Move with confidence, learn new styles, and perform with the campus dance community.',
    category: 'Creative',
    tags: 'Dance,Performance',
    color: 'lilac',
    logo: 'XC',
    style: 'dark',
    img: '/pic/org-logo/Xcite.jpg',
    schedule: 'Every Friday · 5:00 PM',
    eligibility: 'International',
  },
];

const JOIN_QUOTE =
  "I'd love to build practical projects and meet people who are excited about technology.";

/* ---------- Seed ---------- */

/*
 * Nothing runs while the lines below are read. Each add...() call only queues a step.
 * Once everything is queued, series() runs the steps one after another.
 * A step that creates a row saves its new id as ids[key] so later steps can use it.
 */
function seed(done) {
  const conn = mysql.createConnection({
    host: cfg.config.host,
    user: cfg.config.user,
    password: cfg.config.password,
    multipleStatements: true,
  });
  const database = `\`${cfg.config.database}\``;

  const ids = {};
  const steps = [];

  /* Queue a SQL statement. `params` can be a function when it needs ids that do not exist yet. */
  function queue(sql, params, key) {
    steps.push((next) => {
      const values = typeof params === 'function' ? params() : params;
      conn.query(sql, values, (err, result) => {
        if (err) {
          return next(err);
        }
        if (key) {
          ids[key] = result.insertId;
        }
        next();
      });
    });
  }

  function addOrg(o) {
    queue(
      'INSERT INTO organizations (name,description,category,tags,eligibility,color,logo_img,logo_style,meeting_schedule,satisfaction) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        o.name,
        o.description,
        o.category,
        o.tags,
        o.eligibility,
        o.color,
        o.img || o.logo,
        o.style,
        o.schedule,
        o.satisfaction || 4.5,
      ],
      o.key,
    );

    for (const [title, precedence, isOfficer] of DEFAULT_ROLES) {
      queue(
        'INSERT INTO org_roles (org_id, role_title, precedence, is_officer) VALUES (?,?,?,?)',
        () => [ids[o.key], title, precedence, isOfficer],
      );
    }
  }

  /* Every user gets its own password salt; all demo passwords are "password". */
  function addUser(key, name, email, program, year, role = 'student', orgKey = null) {
    steps.push((next) => {
      hashPassword('password', (err, hash) => {
        if (err) {
          return next(err);
        }
        conn.query(
          'INSERT INTO users (full_name,email,password_hash,role,program,year_level,org_id) VALUES (?,?,?,?,?,?,?)',
          [name, email, hash, role, program, year, orgKey ? ids[orgKey] : null],
          (err, result) => {
            if (err) {
              return next(err);
            }
            ids[key] = result.insertId;
            next();
          },
        );
      });
    });
  }

  function addMember(orgKey, userKey, roleTitle, joinedAt) {
    queue(
      'INSERT INTO memberships (org_id,user_id,role_title,joined_at) VALUES (?,?,?,?)',
      () => [ids[orgKey], ids[userKey], roleTitle, joinedAt],
    );
  }

  /* `reviewedAt` is null for pending applications */
  function addApplication(orgKey, userKey, intro, status, createdAt, reviewedAt = null) {
    queue(
      'INSERT INTO applications (org_id,user_id,intro,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?)',
      () => [ids[orgKey], ids[userKey], intro, status, createdAt, reviewedAt],
    );
  }

  function addEvent(key, orgKey, title, inDays, time, place, status, description) {
    queue(
      'INSERT INTO events (org_id,title,event_date,event_time,location,status,description) VALUES (?,?,?,?,?,?,?)',
      () => [ids[orgKey], title, addDays(inDays), time, place, status, description],
      key,
    );
  }

  /* items: [start time or null, segment title, speaker or null], in running order */
  function addProgram(eventKey, items) {
    items.forEach(([start, title, speaker], position) => {
      queue(
        'INSERT INTO event_program (event_id,position,start_time,title,speaker) VALUES (?,?,?,?,?)',
        () => [ids[eventKey], position, start, title, speaker],
      );
    });
  }

  function addNotification(userKey, message, isRead) {
    queue('INSERT INTO notifications (user_id,message,is_read) VALUES (?,?,?)', () => [
      ids[userKey],
      message,
      isRead,
    ]);
  }

  /* ----- Fresh database and tables ----- */
  queue(
    `DROP DATABASE IF EXISTS ${database}; CREATE DATABASE ${database} CHARACTER SET utf8mb4; USE ${database};`,
    [],
  );
  queue(SCHEMA, []);

  /* ----- Organizations and their officer roles ----- */
  ORGANIZATIONS.forEach(addOrg);

  /* ----- Main demo accounts ----- */
  addUser('maya', 'Maya Alvarez', 'maya@north.edu', 'BS Computer Science', 2);
  addUser('alex', 'Alex Rivera', 'admin@codecraft.edu', 'Faculty Advisor', 1, 'adviser', 'UIPC');
  addUser('dana', 'Dana Reyes', 'admin@f1stackmind.edu', 'Faculty Advisor', 1, 'adviser', 'F1');
  addUser('sam', 'Sam Torres', 'admin@citemas.edu', 'Faculty Advisor', 1, 'adviser', 'CITEMAS');
  addUser('kai', 'Kai Mendoza', 'admin@xcite.edu', 'Faculty Advisor', 1, 'adviser', 'Xcite');

  /* ----- UIPC officers and early members ----- */
  const core = [
    ['theo', 'Theo Kim', 'theo@north.edu', 'BS Information Systems', 3, 'President', '2023-10-05'],
    ['morgan', 'Morgan Liu', 'morgan@north.edu', 'BS Computer Science', 3, 'Vice President', '2024-01-12'],
    ['eli', 'Eli Parker', 'eli@north.edu', 'BS Software Engineering', 2, 'Events Lead', '2024-02-09'],
    ['ravi', 'Ravi Nair', 'ravi@north.edu', 'BS Computer Science', 2, 'Member', '2024-09-04'],
    ['chloe', 'Chloe Martin', 'chloe@north.edu', 'BS Data Science', 2, 'Member', '2024-09-18'],
  ];
  for (const [key, name, email, program, year, roleTitle, joinedAt] of core) {
    addUser(key, name, email, program, year);
    addMember('UIPC', key, roleTitle, joinedAt);
  }

  /* ----- UIPC applicants waiting for review ----- */
  const applicants = [
    ['jordan', 'Jordan Lee', 'jordan@north.edu', 'BS Computer Science', 2, 4, JOIN_QUOTE],
    [
      'amara',
      'Amara Nwosu',
      'amara@north.edu',
      'BS Information Technology',
      1,
      3,
      'I want to learn web development and ship a real project with a team.',
    ],
    [
      'sofia',
      'Sofia Reyes',
      'sofia@north.edu',
      'BS Data Science',
      2,
      1,
      'Looking for a place to practice Python and meet people who enjoy debugging together.',
    ],
  ];
  for (const [key, name, email, program, year, daysAgo, intro] of applicants) {
    addUser(key, name, email, program, year);
    addApplication('UIPC', key, intro, 'pending', `${addDays(-daysAgo)} 10:00:00`);
  }
  addApplication('UIPC', 'theo', JOIN_QUOTE, 'approved', '2023-10-01 10:00:00', '2023-10-02 10:00:00');

  /* ----- 30 filler students, so Reports has data to show ----- */
  const firstNames = ['Ana', 'Ben', 'Cleo', 'Dev', 'Ella', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jules'];
  const lastNames = ['Santos', 'Park', 'Okafor'];
  const fillerKeys = [];
  for (const last of lastNames) {
    for (const first of firstNames) {
      const key = `filler${fillerKeys.length}`;
      const email = `${first}.${last}@north.edu`.toLowerCase();
      addUser(key, `${first} ${last}`, email, 'Undeclared', 1 + (fillerKeys.length % 4));
      fillerKeys.push(key);
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

  fillerKeys.forEach((key, i) => {
    if (i < 23) {
      const joined = ymd(new Date(now.getFullYear(), now.getMonth() - monthsAgo[i], 10));
      addMember('UIPC', key, 'Member', joined);
    } else {
      const orgKey = i < 26 ? 'F1' : i < 28 ? 'CITEMAS' : 'Xcite';
      addMember(orgKey, key, 'Member', addDays(-(i * 3)));
    }
  });

  /* ----- Maya: member of Xcite and CITEMAS, pending at F1 Stackmind ----- */
  queue('UPDATE users SET hobbies = ? WHERE id = ?', () => ['Dancing, Animation, Chess', ids.maya]);
  addMember('Xcite', 'maya', 'Member', addDays(-14));
  addMember('CITEMAS', 'maya', 'Member', addDays(-3));
  addApplication(
    'Xcite',
    'maya',
    'I have always loved dancing and want to perform with a team.',
    'approved',
    `${addDays(-16)} 09:00:00`,
    `${addDays(-14)} 09:00:00`,
  );
  addApplication(
    'CITEMAS',
    'maya',
    'I want to learn 2D animation and collaborate on short films.',
    'approved',
    `${addDays(-4)} 09:00:00`,
    `${addDays(-3)} 09:00:00`,
  );
  addApplication(
    'F1',
    'maya',
    'I want to build a product with a fast-moving team.',
    'pending',
    `${addDays(0)} 08:30:00`,
  );
  queue('INSERT INTO bookmarks (user_id,org_id) VALUES (?,?)', () => [ids.maya, ids.CITEMAS]);

  /* ----- Events (the day argument is "days from today") ----- */
  addEvent(
    'hackathon',
    'F1',
    'Hackathon',
    2,
    '09:00',
    'Innovation Lab',
    'published',
    '24 hours of building. Bring a team or find one on the day.',
  );
  addEvent(
    'debugging',
    'UIPC',
    'Debugging',
    3,
    '14:00',
    'Computer Lab 2',
    'published',
    'Bring your broken code and fix it together.',
  );
  addEvent(
    'sprint',
    'UIPC',
    'Open Source Sprint',
    4,
    '14:00',
    'Computer Lab 2',
    'draft',
    'Make your first open source contribution.',
  );
  addEvent(
    'workshop',
    'Xcite',
    'Open Floor Workshop',
    5,
    '17:00',
    'Gym Hall',
    'published',
    'Learn a new style and perform at the end.',
  );
  addEvent(
    'jam',
    'CITEMAS',
    'Animation Jam',
    6,
    '16:00',
    'Media Room',
    'published',
    'Make a 10-second loop in one afternoon.',
  );
  addProgram('hackathon', [
    ['09:00', 'Registration and team forming', null],
    ['09:30', 'Opening keynote: shipping fast', 'Dana Reyes'],
    ['10:00', 'Hacking begins', null],
    ['12:00', 'Mentor office hours', 'Theo Kim'],
    ['17:00', 'Demos and judging', 'Dana Reyes'],
  ]);
  addProgram('debugging', [
    ['14:00', 'Welcome and ground rules', 'Morgan Liu'],
    ['14:15', 'Live debugging: reading stack traces', 'Eli Parker'],
    ['15:00', 'Bring-your-own-bug clinic', null],
    ['16:30', 'Wrap-up and takeaways', 'Alex Rivera'],
  ]);
  addProgram('workshop', [
    ['17:00', 'Warm-up', null],
    ['17:20', 'Learn the routine', 'Kai Mendoza'],
    ['18:15', 'Open floor performance', null],
  ]);
  addProgram('jam', [
    ['16:00', 'Theme reveal', 'Sam Torres'],
    ['16:15', 'Animate!', null],
    ['18:00', 'Screening and feedback', 'Sam Torres'],
  ]);
  for (const key of fillerKeys.slice(0, 12)) {
    queue('INSERT INTO rsvps (event_id,user_id) VALUES (?,?)', () => [ids.debugging, ids[key]]);
  }

  /* Debugging is full (12 of 12) so the waitlist can be tried straight away */
  queue('UPDATE events SET capacity = 12 WHERE id = ?', () => [ids.debugging]);
  queue('UPDATE events SET capacity = 40 WHERE id = ?', () => [ids.hackathon]);

  /* ----- Application questions and announcements ----- */
  ['Why do you want to join UIPC?', 'What is the most interesting thing you have built or learned?'].forEach(
    (question, position) =>
      queue('INSERT INTO org_questions (org_id,position,question) VALUES (?,?,?)', () => [
        ids.UIPC,
        position,
        question,
      ]),
  );
  [
    ['UIPC', 'Welcome to the new semester', 'Meetings are every Thursday at 6:00 PM. Bring a laptop and a friend.'],
    ['UIPC', 'Debugging night is almost full', 'Only a few seats are left. RSVP early or join the waitlist.'],
    ['F1', 'Hackathon teams', 'Teams of up to four. You can also form one on the day.'],
  ].forEach(([orgKey, title, body]) =>
    queue('INSERT INTO announcements (org_id,title,body) VALUES (?,?,?)', () => [ids[orgKey], title, body]),
  );
  [
    ['UIPC', 'Now recruiting: new members', 'We are open to every program. Tell us what you want to build in your application.', 30],
    ['F1', 'Recruiting: event crew', 'Help run the Hackathon: registration desk, logistics and mentors.', 14],
  ].forEach(([orgKey, title, body, days]) =>
    queue(
      "INSERT INTO announcements (org_id,title,body,kind,closes_on) VALUES (?,?,?,'recruitment',DATE_ADD(CURDATE(), INTERVAL ? DAY))",
      () => [ids[orgKey], title, body, days],
    ),
  );

  /* ----- Notifications ----- */
  addNotification('maya', 'CITEMAS accepted your application. Welcome aboard!', 0);
  addNotification('maya', 'New event from UIPC: Debugging', 1);
  addNotification('alex', 'Jordan Lee applied to join UIPC.', 0);
  addNotification('alex', 'Amara Nwosu applied to join UIPC.', 0);

  /* ----- Run everything in order ----- */
  series(steps, (err) => {
    conn.end();
    done(err);
  });
}

seed((err) => {
  if (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  }
  cfg.destroy(); // Release the connection
  console.log(
    '\nDatabase "%s" is ready.\n  Student:  maya@north.edu / password\n  Adviser:  admin@codecraft.edu / password (UIPC)\n',
    cfg.config.database,
  );
});
