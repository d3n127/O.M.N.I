-- ============================================================================
-- O.M.N.I — database, tables and demo data
-- ----------------------------------------------------------------------------
-- SQL equivalent of `npm run setup` (setup.js). Import via phpMyAdmin:
--   Import this file, or from a shell:  mysql -u root -p < database.sql
--
-- This is the single source of truth for the schema: every column, key and
-- seed row that used to live in the migrate-*.js scripts is included below.
--
-- WARNING: drops and recreates the database `fourloop_db` (same as npm run setup).
-- All demo accounts use the password "password" (one shared scrypt hash, exactly
-- like setup.js). Demo dates are relative to the import day (CURDATE()/NOW()),
-- so upcoming events stay upcoming.
-- ============================================================================

DROP DATABASE IF EXISTS `fourloop_db`;
CREATE DATABASE `fourloop_db` CHARACTER SET utf8mb4;
USE `fourloop_db`;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

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

-- Per-organization officer roles. Lower precedence = higher rank.
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

-- Running order of an event: segments with an optional start time and speaker.
CREATE TABLE event_program (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  start_time TIME NULL,
  title VARCHAR(140) NOT NULL,
  speaker VARCHAR(100) NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- `seq` orders the waitlist; `attended` is the adviser's check-in.
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

-- Questions an organization asks applicants; answers keep a copy of the question text.
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
);

-- ----------------------------------------------------------------------------
-- Demo data (same rows as setup.js)
-- Shared scrypt hash of the password "password".
-- ----------------------------------------------------------------------------

SET @pw = 'a9c1a6082291cf408adc66b880923436:ff2be14f0540b28364aec817305b30ef9192d74778c1f0f804155d481bee0f093641982d10375967c9d4b092b7be2961d0b084fbb5dd4bdd90287ab314a2918f';

-- organizations (ids 1..4 in this order). Eligibility 'International' = open to any department.
INSERT INTO organizations (id, name, description, category, tags, eligibility, color, logo_img, logo_style, meeting_schedule, satisfaction) VALUES
(1, 'F1 Stackmind', 'Build fast, think strategically, and turn ambitious ideas into working products.', 'Technology', 'Innovation,Technology', 'College of Engineering',       'yellow', '/pic/org-logo/f1stackmind.jpg', 'tile',  'Every Wednesday · 5:30 PM', 4.5),
(2, 'CITEMAS',      'Bring stories to life through animation, motion, and collaborative visual projects.', 'Creative',   'Animation,Creative',    'College of Arts & Sciences',   'teal',   '/pic/org-logo/citemas.png', 'navy',  'Every Tuesday · 4:00 PM',   4.5),
(3, 'UIPC',         'A welcoming community for every kind of coder, from first program to full stack.',    'Technology', 'All code,Community',    'International',                'lime',   '</>','cream', 'Every Thursday · 6:00 PM',  4.8),
(4, 'Xcite',        'Move with confidence, learn new styles, and perform with the campus dance community.','Creative',   'Dance,Performance',     'International',                'lilac',  '/pic/org-logo/Xcite.jpg', 'dark',  'Every Friday · 5:00 PM',    4.5);

-- default officer roles for every organization
INSERT INTO org_roles (org_id, role_title, precedence, is_officer)
SELECT o.id, r.role_title, r.precedence, r.is_officer
FROM organizations o
CROSS JOIN (
  SELECT 'President' AS role_title, 1 AS precedence, 1 AS is_officer
  UNION ALL SELECT 'Vice President', 2, 1
  UNION ALL SELECT 'Events Lead', 3, 1
  UNION ALL SELECT 'Treasurer', 4, 1
  UNION ALL SELECT 'Secretary', 5, 1
  UNION ALL SELECT 'Member', 6, 0
) r
ORDER BY o.id, r.precedence;

-- users (ids 1..40)
INSERT INTO users (id, full_name, email, password_hash, role, program, year_level, org_id) VALUES
(1,  'Maya Alvarez',  'maya@north.edu',         @pw, 'student', 'BS Computer Science',    2, NULL),
(2,  'Alex Rivera',   'admin@codecraft.edu',    @pw, 'adviser', 'Faculty Advisor',     1, 3),
(3,  'Theo Kim',      'theo@north.edu',         @pw, 'student', 'BS Information Systems', 3, NULL),
(4,  'Morgan Liu',    'morgan@north.edu',       @pw, 'student', 'BS Computer Science',    3, NULL),
(5,  'Eli Parker',    'eli@north.edu',          @pw, 'student', 'BS Software Engineering',2, NULL),
(6,  'Ravi Nair',     'ravi@north.edu',         @pw, 'student', 'BS Computer Science',    2, NULL),
(7,  'Chloe Martin',  'chloe@north.edu',        @pw, 'student', 'BS Data Science',        2, NULL),
(8,  'Jordan Lee',    'jordan@north.edu',       @pw, 'student', 'BS Computer Science',    2, NULL),
(9,  'Amara Nwosu',   'amara@north.edu',        @pw, 'student', 'BS Information Technology',       1, NULL),
(10, 'Sofia Reyes',   'sofia@north.edu',        @pw, 'student', 'BS Data Science',        2, NULL),
(11, 'Ana Santos',    'ana.santos@north.edu',   @pw, 'student', 'Undeclared',          1, NULL),
(12, 'Ben Santos',    'ben.santos@north.edu',   @pw, 'student', 'Undeclared',          2, NULL),
(13, 'Cleo Santos',   'cleo.santos@north.edu',  @pw, 'student', 'Undeclared',          3, NULL),
(14, 'Dev Santos',    'dev.santos@north.edu',   @pw, 'student', 'Undeclared',          4, NULL),
(15, 'Ella Santos',   'ella.santos@north.edu',  @pw, 'student', 'Undeclared',          1, NULL),
(16, 'Finn Santos',   'finn.santos@north.edu',  @pw, 'student', 'Undeclared',          2, NULL),
(17, 'Gia Santos',    'gia.santos@north.edu',   @pw, 'student', 'Undeclared',          3, NULL),
(18, 'Hugo Santos',   'hugo.santos@north.edu',  @pw, 'student', 'Undeclared',          4, NULL),
(19, 'Iris Santos',   'iris.santos@north.edu',  @pw, 'student', 'Undeclared',          1, NULL),
(20, 'Jules Santos',  'jules.santos@north.edu', @pw, 'student', 'Undeclared',          2, NULL),
(21, 'Ana Park',      'ana.park@north.edu',     @pw, 'student', 'Undeclared',          3, NULL),
(22, 'Ben Park',      'ben.park@north.edu',     @pw, 'student', 'Undeclared',          4, NULL),
(23, 'Cleo Park',     'cleo.park@north.edu',    @pw, 'student', 'Undeclared',          1, NULL),
(24, 'Dev Park',      'dev.park@north.edu',     @pw, 'student', 'Undeclared',          2, NULL),
(25, 'Ella Park',     'ella.park@north.edu',    @pw, 'student', 'Undeclared',          3, NULL),
(26, 'Finn Park',     'finn.park@north.edu',    @pw, 'student', 'Undeclared',          4, NULL),
(27, 'Gia Park',      'gia.park@north.edu',     @pw, 'student', 'Undeclared',          1, NULL),
(28, 'Hugo Park',     'hugo.park@north.edu',    @pw, 'student', 'Undeclared',          2, NULL),
(29, 'Iris Park',     'iris.park@north.edu',    @pw, 'student', 'Undeclared',          3, NULL),
(30, 'Jules Park',    'jules.park@north.edu',   @pw, 'student', 'Undeclared',          4, NULL),
(31, 'Ana Okafor',    'ana.okafor@north.edu',   @pw, 'student', 'Undeclared',          1, NULL),
(32, 'Ben Okafor',    'ben.okafor@north.edu',   @pw, 'student', 'Undeclared',          2, NULL),
(33, 'Cleo Okafor',   'cleo.okafor@north.edu',  @pw, 'student', 'Undeclared',          3, NULL),
(34, 'Dev Okafor',    'dev.okafor@north.edu',   @pw, 'student', 'Undeclared',          4, NULL),
(35, 'Ella Okafor',   'ella.okafor@north.edu',  @pw, 'student', 'Undeclared',          1, NULL),
(36, 'Finn Okafor',   'finn.okafor@north.edu',  @pw, 'student', 'Undeclared',          2, NULL),
(37, 'Gia Okafor',    'gia.okafor@north.edu',   @pw, 'student', 'Undeclared',          3, NULL),
(38, 'Hugo Okafor',   'hugo.okafor@north.edu',  @pw, 'student', 'Undeclared',          4, NULL),
(39, 'Iris Okafor',   'iris.okafor@north.edu',  @pw, 'student', 'Undeclared',          1, NULL),
(40, 'Jules Okafor',  'jules.okafor@north.edu', @pw, 'student', 'Undeclared',          2, NULL),
-- advisers for the other organizations (UIPC's adviser is user 2)
(41, 'Dana Reyes',    'admin@f1stackmind.edu',  @pw, 'adviser', 'Faculty Advisor',     1, 1),
(42, 'Sam Torres',    'admin@citemas.edu',      @pw, 'adviser', 'Faculty Advisor',     1, 2),
(43, 'Kai Mendoza',   'admin@xcite.edu',        @pw, 'adviser', 'Faculty Advisor',     1, 4);

-- hobbies for the demo student
UPDATE users SET hobbies = 'Dancing, Animation, Chess' WHERE id = 1;

-- memberships: UIPC core team (fixed history dates)
INSERT INTO memberships (org_id, user_id, role_title, joined_at) VALUES
(3, 3,  'President',       '2023-10-05'),
(3, 4,  'Vice President',  '2024-01-12'),
(3, 5,  'Events Lead',     '2024-02-09'),
(3, 6,  'Member',          '2024-09-04'),
(3, 7,  'Member',          '2024-09-18');

-- memberships: filler students (users 11..40; 23 in UIPC, 3 F1 Stackmind, 2 CITEMAS, 2 Xcite)
INSERT INTO memberships (org_id, user_id, role_title, joined_at) VALUES
(3, 11, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-10')),
(3, 12, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-10')),
(3, 13, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 MONTH), '%Y-%m-10')),
(3, 14, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 MONTH), '%Y-%m-10')),
(3, 15, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 MONTH), '%Y-%m-10')),
(3, 16, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-10')),
(3, 17, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-10')),
(3, 18, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-10')),
(3, 19, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-10')),
(3, 20, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-10')),
(3, 21, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-10')),
(3, 22, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-10')),
(3, 23, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-10')),
(3, 24, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-10')),
(3, 25, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-10')),
(3, 26, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-10')),
(3, 27, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(3, 28, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(3, 29, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(3, 30, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(3, 31, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(3, 32, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(3, 33, 'Member', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 0 MONTH), '%Y-%m-10')),
(1, 34, 'Member', DATE_SUB(CURDATE(), INTERVAL 69 DAY)),
(1, 35, 'Member', DATE_SUB(CURDATE(), INTERVAL 72 DAY)),
(1, 36, 'Member', DATE_SUB(CURDATE(), INTERVAL 75 DAY)),
(2, 37, 'Member', DATE_SUB(CURDATE(), INTERVAL 78 DAY)),
(2, 38, 'Member', DATE_SUB(CURDATE(), INTERVAL 81 DAY)),
(4, 39, 'Member', DATE_SUB(CURDATE(), INTERVAL 84 DAY)),
(4, 40, 'Member', DATE_SUB(CURDATE(), INTERVAL 87 DAY));

-- memberships: Maya (Xcite + CITEMAS)
INSERT INTO memberships (org_id, user_id, role_title, joined_at) VALUES
(4, 1, 'Member', DATE_SUB(CURDATE(), INTERVAL 14 DAY)),
(2, 1, 'Member', DATE_SUB(CURDATE(), INTERVAL 3 DAY));

-- applications (same order as setup.js: three applicants, then Theo's history row)
INSERT INTO applications (org_id, user_id, intro, status, created_at, reviewed_at) VALUES
(3, 8, 'I''d love to build practical projects and meet people who are excited about technology.', 'pending',  DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '%Y-%m-%d 10:00:00'), NULL),
(3, 9, 'I want to learn web development and ship a real project with a team.',                   'pending',  DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '%Y-%m-%d 10:00:00'), NULL),
(3, 10,'Looking for a place to practice Python and meet people who enjoy debugging together.',    'pending',  DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d 10:00:00'), NULL),
(3, 3, 'I''d love to build practical projects and meet people who are excited about technology.', 'approved', '2023-10-01 10:00:00', '2023-10-02 10:00:00'),
(4, 1, 'I have always loved dancing and want to perform with a team.',  'approved', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 16 DAY), '%Y-%m-%d 09:00:00'), DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 14 DAY), '%Y-%m-%d 09:00:00')),
(2, 1, 'I want to learn 2D animation and collaborate on short films.',  'approved', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 DAY),  '%Y-%m-%d 09:00:00'), DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 DAY),  '%Y-%m-%d 09:00:00')),
(1, 1, 'I want to build a product with a fast-moving team.',           'pending',  CONCAT(CURDATE(), ' 08:30:00'), NULL);

-- bookmarks: Maya saved CITEMAS
INSERT INTO bookmarks (user_id, org_id) VALUES (1, 2);

-- events (ids 1..5; days relative to today)
INSERT INTO events (id, org_id, title, event_date, event_time, location, status, description) VALUES
(1, 1, 'Hackathon',            DATE_ADD(CURDATE(), INTERVAL 2 DAY), '09:00:00', 'Innovation Lab', 'published', '24 hours of building. Bring a team or find one on the day.'),
(2, 3, 'Debugging',            DATE_ADD(CURDATE(), INTERVAL 3 DAY), '14:00:00', 'Computer Lab 2', 'published', 'Bring your broken code and fix it together.'),
(3, 3, 'Open Source Sprint',   DATE_ADD(CURDATE(), INTERVAL 4 DAY), '14:00:00', 'Computer Lab 2', 'draft',     'Make your first open source contribution.'),
(4, 4, 'Open Floor Workshop',  DATE_ADD(CURDATE(), INTERVAL 5 DAY), '17:00:00', 'Gym Hall',       'published', 'Learn a new style and perform at the end.'),
(5, 2, 'Animation Jam',        DATE_ADD(CURDATE(), INTERVAL 6 DAY), '16:00:00', 'Media Room',     'published', 'Make a 10-second loop in one afternoon.');

-- event program (event_id, position, start_time, title, speaker)
INSERT INTO event_program (event_id, position, start_time, title, speaker) VALUES
(1, 0, '09:00:00', 'Registration and team forming',       NULL),
(1, 1, '09:30:00', 'Opening keynote: shipping fast',      'Dana Reyes'),
(1, 2, '10:00:00', 'Hacking begins',                      NULL),
(1, 3, '12:00:00', 'Mentor office hours',                 'Theo Kim'),
(1, 4, '17:00:00', 'Demos and judging',                   'Dana Reyes'),
(2, 0, '14:00:00', 'Welcome and ground rules',            'Morgan Liu'),
(2, 1, '14:15:00', 'Live debugging: reading stack traces','Eli Parker'),
(2, 2, '15:00:00', 'Bring-your-own-bug clinic',           NULL),
(2, 3, '16:30:00', 'Wrap-up and takeaways',               'Alex Rivera'),
(4, 0, '17:00:00', 'Warm-up',                             NULL),
(4, 1, '17:20:00', 'Learn the routine',                   'Kai Mendoza'),
(4, 2, '18:15:00', 'Open floor performance',              NULL),
(5, 0, '16:00:00', 'Theme reveal',                        'Sam Torres'),
(5, 1, '16:15:00', 'Animate!',                            NULL),
(5, 2, '18:00:00', 'Screening and feedback',              'Sam Torres');
  
-- capacity: Debugging is full (12 of 12) so the waitlist can be tried straight away
UPDATE events SET capacity = 12 WHERE id = 2;
UPDATE events SET capacity = 40 WHERE id = 1;

-- rsvps: 12 students on Debugging (event 2)
INSERT INTO rsvps (event_id, user_id) VALUES
(2, 11), (2, 12), (2, 13), (2, 14), (2, 15), (2, 16),
(2, 17), (2, 18), (2, 19), (2, 20), (2, 21), (2, 22);

-- application questions and announcements
INSERT INTO org_questions (org_id, position, question) VALUES
(3, 0, 'Why do you want to join UIPC?'),
(3, 1, 'What is the most interesting thing you have built or learned?');

INSERT INTO announcements (org_id, title, body) VALUES
(3, 'Welcome to the new semester',      'Meetings are every Thursday at 6:00 PM. Bring a laptop and a friend.'),
(3, 'Debugging night is almost full',   'Only a few seats are left. RSVP early or join the waitlist.'),
(1, 'Hackathon teams',                  'Teams of up to four. You can also form one on the day.');

INSERT INTO announcements (org_id, title, body, kind, closes_on) VALUES
(3, 'Now recruiting: new members', 'We are open to every program. Tell us what you want to build in your application.', 'recruitment', DATE_ADD(CURDATE(), INTERVAL 30 DAY)),
(1, 'Recruiting: event crew',      'Help run the Hackathon: registration desk, logistics and mentors.',                 'recruitment', DATE_ADD(CURDATE(), INTERVAL 14 DAY));

-- notifications
INSERT INTO notifications (user_id, message, is_read) VALUES
(1, 'CITEMAS accepted your application. Welcome aboard!',    0),
(1, 'New event from UIPC: Debugging',                        1),
(2, 'Jordan Lee applied to join UIPC.',                      0),
(2, 'Amara Nwosu applied to join UIPC.',                     0);
