# 4loopGroup — Software Specification

**Project:** 4loopGroup (fourloopgroup) v1.0.0
**Type:** Student organization portal — server-rendered web application
**Stack:** Node.js · Express 4 · EJS 3 · MySQL 8 (mysql2) · express-session
**Document status:** Baseline specification, derived from the implemented codebase (commit `0f71571`).

---

## 1. Overview and objectives

4loopGroup is a university portal that connects students with campus organizations. It provides two
role-scoped areas behind a single login:

| Role | Area | Purpose |
| --- | --- | --- |
| `student` | `/student` | Discover organizations, apply to join, RSVP to events, track applications. |
| `admin` | `/admin` | A faculty/student officer managing **one** organization: profile, members, applications, events, reports. |

**Objectives**

1. Let a student find an organization, apply, and receive a decision without leaving the portal.
2. Let an organization officer review applications and publish events to members in one place.
3. Give the officer measurable insight into membership growth, acceptance and attendance.
4. Deliver all of the above as a single deployable app with no build step and no third-party auth.

**Design constraints**

- Server-rendered EJS pages; no client-side SPA and no bundler.
- Passwords hashed with Node's built-in `crypto.scrypt` — no authentication dependency.
- Seeded, reproducible demo database so every install shows the same realistic data.

---

## 2. Setup and run requirements

| Step | Command / action | Notes |
| --- | --- | --- |
| 1 | `npm install` | Installs express, ejs, express-session, mysql2, nodemon. |
| 2 | Edit `config.js` (or set env vars) | `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `PORT`. Defaults: `localhost` / `root` / `fourloop_db` / `3000`. Start MySQL (e.g. XAMPP). |
| 3 | `npm run setup` | **Drops and recreates** the database, applies the schema, loads demo data. Destructive by design. |
| 4 | `npm start` | Runs `nodemon app.js` → `http://localhost:3000`. `npm run dev` uses `node --watch`. |

**Demo credentials** (password for all: `password`)

- Student: `maya@north.edu`
- Admin: `admin@codecraft.edu` (officer of *UIPC*)

**Runtime requirements:** Node.js 18+, MySQL 8.0+ (or MariaDB with `TIMESTAMP`/`ENUM` support),
~50 MB disk for dependencies and seed data.

---

## 3. System architecture

### 3.1 Request lifecycle

```
HTTP request
   │
   ▼
app.js
   ├─ express.static(public)            static CSS / JS / images
   ├─ express.urlencoded / express.json body parsing
   ├─ express-session                   cookie session (8 h), secret from SESSION_SECRET
   ├─ global middleware (wrap)          sets res.locals: me, flash, notes, unread, badge
   │
   ├─ '/'              → routes/auth        public: landing, login, register, logout
   ├─ '/student'       → routes/student     guarded by requireRole('student')
   ├─ '/admin'         → routes/admin       guarded by requireRole('admin')
   ├─ 'POST /notifications/read'            marks a user's notifications read
   │
   ├─ 404 handler                        plain-text fallback with a home link
   └─ 500 handler                        logs the error, returns a friendly page
```

### 3.2 Modules

| File | Responsibility |
| --- | --- |
| `app.js` | App wiring: view engine, static, body parsers, session, per-request locals, router mounting, error handlers, listener. |
| `config.js` | Environment-driven configuration (DB host/user/pass/name, port, session secret elsewhere). |
| `conn.js` | `mysql2` connection pool (`connectionLimit: 10`, `dateStrings: true` so `DATE`/`TIMESTAMP` arrive as `YYYY-MM-DD…` strings for the `utils.js` formatters) exported as a promise-wrapped `db` handle. |
| `middleware.js` | `wrap(fn)` — forwards rejected promises to `next`; `requireRole(role)` — session/role gate with redirect; `flash(req,msg,type)` — one-shot session message. |
| `utils.js` | `hashPassword` / `verifyPassword` (scrypt + `timingSafeEqual`), date helpers (`ymd`, `MON`, `fmtShort/Day/Mon/Long/MonthYear/Time`), `initials`, inline SVG `icon()` registry, exported as `app.locals` via `viewHelpers`. |
| `setup.js` | Standalone seeder: creates DB + 8 tables + demo rows. |
| `routes/auth.js` | Landing, login/register rendering and submission, logout. |
| `routes/student/index.js` | Student portal pages and actions. |
| `routes/admin/index.js` | Officer portal pages, actions, statistics and CSV export. |

### 3.3 View structure

```
views/
├── shared/    index (landing), auth (login/register), head, foot, logo, tools
├── student/   home, discover, applications, events, organizations
│              └── partials/ top, bottom, orgcard, apply_modal
└── admin/     overview, organization, members, applications, events, reports, settings
               └── partials/ top, bottom
```

`res.locals` available to every template: `me` (session user or `null`), `flash`, `notes`
(latest 8 notifications), `unread`, `badge` (role-specific pending count), plus helper functions
`icon`, `initials`, `fmtShort`, `fmtDay`, `fmtMon`, `fmtLong`, `fmtMonthYear`, `fmtTime`.

### 3.4 Client assets

| Path | Role |
| --- | --- |
| `public/css/shared/base.css` | Design tokens, reset, layout, nav, buttons, cards, forms, badges. |
| `public/css/student/student.css` | Student dashboard and portal styling. |
| `public/css/admin/admin.css` | Officer dashboard styling. |
| `public/js/shared/common.js` | Flash dismissal, notification drawer, mark-read fetch, confirm dialogs. |
| `public/js/student/student.js` | Apply modal, bookmark toggle, RSVP, search/filter. |
| `public/js/admin/admin.js` | Event forms, member actions, confirm prompts. |

---

## 4. Data model

All tables are created by `setup.js`. Charset `utf8mb4`.

### 4.1 `organizations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INT PK AI | |
| `name` | VARCHAR(120) NOT NULL | |
| `description` | TEXT | |
| `category` | VARCHAR(40) NOT NULL | default `Technology` |
| `tags` | VARCHAR(160) NOT NULL | comma-separated |
| `color` | ENUM(`yellow`,`teal`,`lime`,`lilac`) | card accent |
| `logo_text` | VARCHAR(4) | max 4 characters |
| `logo_style` | ENUM(`tile`,`navy`,`cream`,`dark`) | |
| `meeting_schedule` | VARCHAR(120) | default `To be announced` |
| `satisfaction` | DECIMAL(2,1) | default `4.5`, feeds the health score |
| `created_at` | TIMESTAMP | default now |

### 4.2 `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INT PK AI | |
| `full_name` | VARCHAR(120) NOT NULL | |
| `email` | VARCHAR(160) NOT NULL | |
| `password_hash` | VARCHAR(200) | `salt:hexkey` from scrypt |
| `role` | ENUM(`student`,`admin`) NOT NULL | |
| `program` | VARCHAR(100) | default `Undeclared` |
| `year_level` | TINYINT | default 1 |
| `org_id` | INT NULL | FK → `organizations.id` ON DELETE SET NULL (officer's org) |
| `created_at` | TIMESTAMP | |

Constraints: `UNIQUE (email, role)` — the same address may exist once per role.

### 4.3 `memberships`

`id` PK · `org_id` FK CASCADE · `user_id` FK CASCADE · `role_title` VARCHAR(40) default `Member` ·
`joined_at` DATE NOT NULL · `UNIQUE (org_id, user_id)`.

Officer role vocabulary: `President`, `Vice President`, `Events Lead`, `Treasurer`, `Secretary`, `Member`.

### 4.4 `applications`

`id` PK · `org_id` FK CASCADE · `user_id` FK CASCADE · `intro` TEXT ·
`status` ENUM(`pending`,`approved`,`rejected`) default `pending` · `created_at` TIMESTAMP ·
`reviewed_at` TIMESTAMP NULL · `UNIQUE (org_id, user_id)`.

### 4.5 `events`

`id` PK · `org_id` FK CASCADE · `title` VARCHAR(140) · `event_date` DATE · `event_time` TIME ·
`location` VARCHAR(140) default `TBA` · `description` TEXT ·
`status` ENUM(`draft`,`published`) default `draft`.

Only `published` events with `event_date >= CURDATE()` are visible to students
(predicate `UPCOMING` in `routes/student/index.js`).

### 4.6 `rsvps`

`event_id` + `user_id` composite PK, both FK CASCADE. Presence of a row = the student is going.

### 4.7 `bookmarks`

`user_id` + `org_id` composite PK, both FK CASCADE. Presence of a row = organization saved.

### 4.8 `notifications`

`id` PK AI · `user_id` FK CASCADE · `message` VARCHAR(255) · `is_read` TINYINT(1) default 0 ·
`created_at` TIMESTAMP.

### 4.9 Seed data (`setup.js`)

- **Organizations (4):** F1 Stackmind (Technology), CITEMAS (Creative), UIPC (Technology, satisfaction 4.8), Xcite (Creative).
- **Users:** `maya@north.edu` (student, member of Xcite + CITEMAS, pending at F1 Stackmind, one bookmark),
  `admin@codecraft.edu` (officer of UIPC), 5 UIPC core officers, 3 pending UIPC applicants,
  30 filler students distributed across orgs to make reports meaningful.
- **Applications:** 3 pending for UIPC, approved history for Theo Kim and Maya.
- **Events (5):** Hackathon, Debugging (12 RSVPs), Open Source Sprint (draft), Open Floor Workshop, Animation Jam — dates relative to today.
- **Notifications:** 2 for Maya, 2 for the UIPC officer.

---

## 5. Functional requirements

Format: `FR-<AREA>-<n>` — `<route/method>` · inputs · validation · outcome.
`progress.md` traces completed items back to these IDs.

### 5.1 FR-AUTH — Authentication and session

| ID | Requirement |
| --- | --- |
| FR-AUTH-1 | `GET /` — render the landing page; if a session already exists, redirect to `/student` or `/admin` according to `role`. |
| FR-AUTH-2 | `GET /login/:role` — render login for `student` or `admin`; any other role redirects to `/`. `?mode=register` renders the registration form. On validation error, respond **400** with the same view. |
| FR-AUTH-3 | `POST /auth/login` — look up `email` (trimmed, lowercased) + `role`; verify with scrypt `timingSafeEqual`. On failure, re-render with *“Incorrect email or password…”* and echo the email. On success set `req.session.user = { id, name, role, org_id }` and redirect to the role home. |
| FR-AUTH-4 | `POST /auth/register` — validate: name and email required; email matches `^\S+@\S+\.\S+$`; password ≥ 6 chars; **admin** must supply an organization name. Reject duplicate `(email, role)`. For an admin, create the `organizations` row first (random accent color, 2-letter logo, category `Technology`), then the `users` row, then open the session. |
| FR-AUTH-5 | `GET /logout` — destroy the session and redirect to `/`. |
| FR-AUTH-6 | `requireRole(role)` gates `/student` and `/admin`: no session → redirect to `/login/<role>`; wrong role → redirect to the caller's own portal. |

### 5.2 FR-STUDENT — Student portal

| ID | Requirement |
| --- | --- |
| FR-STUDENT-1 | `GET /student` — dashboard: all organizations (with member count, bookmark flag, application status, membership flag), counts for joined organizations / pending applications / upcoming events, the next 3 upcoming events, the 2 most recent applications, and the category list for filtering. |
| FR-STUDENT-2 | `GET /student/discover?q=` — browse organizations with free-text search across `name`, `description`, `tags`, `category`; category list for filter chips. |
| FR-STUDENT-3 | `POST /student/apply` — JSON API. Inputs `org_id`, `intro`, `agree`. Reject with 400/404 when: intro empty, `agree` absent, organization missing, user already a member, or a non-rejected application already exists. If a previous application was **rejected**, reset it to `pending` with a fresh `created_at` and cleared `reviewed_at`; otherwise insert. Notify every officer of that organization. Return `{ ok: true, name }`. |
| FR-STUDENT-4 | `POST /student/bookmark/:id` — toggle; returns `{ saved: boolean }`. |
| FR-STUDENT-5 | `GET /student/events?org=` — list upcoming published events with a `joined` flag and the organization name; optional filter by organization, with `filterOrg` resolved for the heading. |
| FR-STUDENT-6 | `POST /student/events/:id/rsvp` — toggle RSVP (insert only if the event is `published`), then redirect back to the `Referer`. |
| FR-STUDENT-7 | `GET /student/applications` and `GET /student/organizations` — full application history with org identity; organizations joined with `joined_at`, `role_title` and upcoming-event count. The Applications tab badge shows the number of `pending` applications. |

### 5.3 FR-ADMIN — Officer portal

All `/admin` routes require role `admin`, load the officer's `organizations` row (destroying the session if it no longer exists), and expose the pending-application badge.

| ID | Requirement |
| --- | --- |
| FR-ADMIN-1 | `GET /admin` — overview: greeting by time of day, today's date, the last 3 applications, the next published event with up to 3 attendees and the total RSVP count, and the statistics of FR-ADMIN-7. |
| FR-ADMIN-2 | `GET|POST /admin/organization` — view and edit profile: name (required, else flash error), description, category (whitelist of 6), tags (≤160 chars), logo text (≤4 chars, else initials), meeting schedule. Flash *“Changes saved…”* on success. |
| FR-ADMIN-3 | `GET /admin/members?q=` — members ordered by role precedence then join date; search across name, email and role title. |
| FR-ADMIN-4 | `POST /admin/members/invite` — resolve a **student** account by email; unknown email → error flash; already a member → error flash; otherwise insert with role `Member` and notify the student. |
| FR-ADMIN-5 | `POST /admin/members/:mid/role` and `POST /admin/members/:mid/remove` — change a role (whitelisted) or delete the membership; both scoped by `org_id`. |
| FR-ADMIN-6 | `POST /admin/applications/:id/:action` — only `approve`/`decline`, only for a `pending` application of this organization. Approval inserts a `Member` membership; both outcomes set `reviewed_at` and notify the applicant. |
| FR-ADMIN-7 | `orgStats(org)` — shared metrics for Overview and Reports: total members; members joined this month; pending applications; upcoming published events and their RSVPs; **attendance %** = `RSVPs(all published events) / (events × members)` capped at 100; **acceptance %** = approved / decided; **health score** = round((attendance + acceptance + satisfaction × 20) / 3). |
| FR-ADMIN-8 | `GET|POST /admin/events` — list events with RSVP counts; create with validation (`title`, `YYYY-MM-DD` date, `HH:MM` time required) and status `draft`/`published`; publishing (on create or on draft→published transition) notifies all members. `POST /admin/events/:id` updates, `POST /admin/events/:id/delete` removes — both scoped by `org_id`. |
| FR-ADMIN-9 | `GET /admin/reports` and `GET /admin/reports/export` — 6-month membership-growth series (Jan–Dec labels, zero-filled) and the CSV export `"<org>-report.csv"` containing the metric block plus the monthly series (`text/csv`, attachment disposition). |
| FR-ADMIN-10 | `GET|POST /admin/settings` — update `full_name`; change the password only if the current password verifies and the new one is ≥ 6 chars; the session name is refreshed so the UI updates immediately. |

### 5.4 FR-NOTIFY — Notifications and messaging

| ID | Requirement |
| --- | --- |
| FR-NOTIFY-1 | On every request the global middleware loads the user's 8 most recent notifications and the unread count into `res.locals` (`notes`, `unread`). |
| FR-NOTIFY-2 | `POST /notifications/read` — marks all of the current user's notifications read; returns `{ ok: false }` with 401 when unauthenticated. |
| FR-NOTIFY-3 | Producers: application submitted (officers), application decided (applicant), member invited (student), event published (all members). Flash messages carry page-level confirmations separately from notifications. |

---

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Security — passwords | scrypt with a random 16-byte hex salt, 64-byte key, constant-time comparison (`crypto.timingSafeEqual`). No plaintext or reversible storage. |
| Security — access | Every `/student` and `/admin` route is behind `requireRole`; all mutating queries are scoped by `org_id` from the session (an officer cannot touch another organization's rows). |
| Security — session | 8-hour rolling-value cookie; secret overridable with `SESSION_SECRET`; session destroyed on logout and when an officer's organization disappears. |
| Security — input | Server-side validation on every write; parameterized queries everywhere (no string-concatenated user input in SQL, except whitelisted `LIMIT`/`ORDER BY` fragments). |
| Error handling | `wrap()` converts async rejections into the Express error handler; a 404 catch-all and a logged 500 page prevent stack traces leaking to users. |
| Feedback | One-shot flash messages, inline form errors (status 400 on auth views), and JSON error bodies for AJAX endpoints. |
| Performance | Single aggregated query per card list (correlated subqueries instead of N+1 loops), indexed PK/unique keys on every join table, event lists bounded by the `UPCOMING` predicate. |
| Portability | No build step; configuration via environment variables with sensible local defaults; static assets served from `public/`. |
| Accessibility | Semantic forms and labels, `aria-hidden` decorative SVG icons, visible focus states, colour not used as the sole status indicator (badges carry text). |

---

## 7. Assumptions, exclusions and risks

### Assumptions

1. One officer account manages exactly one organization (`users.org_id`); officers are not members of other orgs through this role.
2. Email addresses are trusted as identifiers; there is no email verification.
3. Dates are handled in server-local time; `CURDATE()` in SQL and `new Date()` in Node must agree.
4. The demo database may be destroyed at any time by `npm run setup`.

### Exclusions (not in scope for v1.0.0)

- Password reset / forgot-password flow; email delivery of any kind.
- CSRF tokens on form submissions (mitigated only by same-site session cookies).
- Persistent session store (sessions live in process memory).
- Pagination, sorting controls, and infinite scroll on list views.
- File uploads (organization logos are text/colour presets only).
- Automated tests, CI pipeline, and linting configuration.
- Multi-organization accounts, role delegation, or an administrator above the officer role.

### Risks / known issues

| # | Risk | Impact | Mitigation planned |
| --- | --- | --- | --- |
| R1 | DB credentials are committed in `config.js`. | Credential leak if the repo is public. | Move to env-only defaults; rotate the password. |
| R2 | No CSRF protection on POST routes. | State-changing requests could be forged. | Add a session CSRF token to all forms and AJAX headers. |
| R3 | In-memory sessions. | All users logged out on restart/deploy. | `connect-mysql` (or equivalent) session store. |
| R4 | Unlimited admin self-registration creates organizations. | Database clutter / spam orgs. | Approval step or a registration allow-list. |
| R5 | No tests. | Regressions in statistics and application state machine go unnoticed. | Unit tests for `orgStats`, `utils`, and the application transitions. |
