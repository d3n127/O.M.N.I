# O.M.N.I Backend Explanation

The backend is a Node.js server built with **Express**. It renders pages with **EJS** templates and stores data in **MySQL** (database `fourloop_db`). This document explains what each file and folder does.

## Request flow

```
Browser -> app.js (middleware) -> routes/<area> -> MySQL (conn.js) -> views/<area>.ejs -> HTML back to the browser
```

1. `app.js` receives every request. It loads the session and the signed-in user, then sets values every page uses.
2. The request is passed to a router in `routes/`.
3. The router checks the user's role, queries MySQL and renders an EJS view, or redirects.

---

## Root files

| File | What it does |
|---|---|
| **app.js** | Entry point. Sets up Express, EJS, static files and sessions (8-hour cookie). Runs two middleware on every request: `loadUser` re-reads the user and role from the DB, so role changes and deleted accounts apply immediately. The second sets `me`, the flash message, the latest 8 notifications and the unread count for the views. It then mounts the routers, defines `POST /notifications/read`, adds the 404 and 500 handlers, and starts the server on port 3000 (with a clear message if the port is taken). |
| **conn.js** | Creates the MySQL connection (user `root`, host `localhost`, empty password, database `fourloop_db`). Every route file imports it. |
| **utils.js** | Shared helpers: `wrap` (sends async errors to Express), `flash` (one-time toast message), `ROLES` (`student`, `adviser`), `hashPassword` / `verifyPassword` (random salt + scrypt, stored as `salt:hexkey`), date helpers, the `DEPARTMENTS` list with abbreviations, and the inline SVG `icon()` used in views. |
| **setup.js** | Run with `npm run setup`. Drops and recreates the database, creates all tables and fills them with demo data (organizations, users, events, applications, notifications). **It resets all data every time.** |
| **database.sql** | The single source of truth for the database: every table, column, key and demo row as plain SQL, for importing by hand (for example in phpMyAdmin). Changes to the schema go here (and in `setup.js`), not in separate migration scripts. |
| **package.json** | Dependencies (`express`, `ejs`, `express-session`, `mysql2`, `nodemon`) and scripts: `setup`, `start` (nodemon), `dev` (`node --watch`). |
| **README.md** | How to install and run the project. |

---

## routes/ (the backend logic)

### routes/auth.js (sign-in, sign-up, guards)
- **Pages and actions:** `GET /` (landing page, or redirect if signed in), `GET /login`, `GET /register`, `POST /auth/login`, `POST /auth/register`, `GET /logout`. The old `/login/:role` URLs redirect to the new pages.
- **Unified sign-in:** the email identifies the account and the account row carries the role, so students and advisers use the same form.
- **Sign-up:** a student can register. An adviser must also give an organization name, which creates the organization.
- **Guards exported for other routers:**
  - `requireAuth`: must be signed in.
  - `requireRole('student' | 'adviser')`: a wrong role is sent to its own portal, and anonymous visitors go to sign-in.
  - `requireNonMember` and `lockNonMembers`: keep students with 0 organizations in `/nonmember` and members in `/student`.
  - `requireStudentInfo`: students must finish `/student-info` before using the portals.
  - `homeFor` and `hasOrg`: decide where a user belongs (advisers go to `/admin`).

### routes/profile.js (shared account pages)
- `GET/POST /student-info`: the required student information form shown right after registering. Students only.
- `GET /profile`: read-only profile with the student's organizations.
- `GET /settings`: the settings page.
- `POST /profile`: edit profile details. The email must be unique across all roles.
- `POST /profile/password`: change password.
- It chooses which portal layout to render in (admin sidebar, student top bar or nonmember top bar). Its guards are scoped to these paths only, because the router is mounted at `/`.

### routes/apply.js (shared helper)
`applyToOrg` is used by both `/student/apply` and `/nonmember/apply`. It accepts students only, requires an intro and consent, rejects unknown organizations and existing members, and blocks duplicate applications unless the earlier one was rejected. Otherwise it creates or resubmits the application, so both portals behave identically.

### routes/student/index.js (`/student`, for members)
Guarded by `requireRole('student')`, `requireStudentInfo` and `lockNonMembers`.
- `/`: home with stats, organization suggestions and upcoming events.
- `/discover`: browse and search organizations, with category and eligibility filters.
- `/applications`: the student's applications and their status. Also feeds the pending badge on the tab.
- `POST /apply`: apply to an organization.
- `POST /bookmark/:id`: toggle a bookmark (returns JSON).
- `/events` and `POST /events/:id/rsvp`: list events of the student's organizations and toggle an RSVP (published events only).
- `/organizations`: organizations the student has joined, with role and upcoming events.

### routes/nonmember/index.js (`/nonmember`, students with 0 organizations)
A limited portal for students who have not joined anything yet. It has a limited home, `/discover`, `POST /apply`, `/events` and `POST /events/:id/rsvp`. As soon as their first application is approved they move to `/student`.

### routes/admin/index.js (`/admin`, adviser portal)
Adviser only. A middleware loads the adviser's organization, its officer roles and the pending-applications count for every page.
- `/`: overview with member, application and event numbers and the next 5 upcoming events with RSVP counts.
- `/organization` (GET and POST): edit the organization profile (name, description, category, tags, eligibility, logo, schedule).
- `/members`: list and search members. `POST /members/invite` adds a student by email and notifies them. `POST /members/:mid/role` changes a role. `POST /members/:mid/remove` removes a member.
- `/officers`: the officer hierarchy. Advisers can add, rename, reorder (up or down) and delete roles. Lower precedence means higher rank.
- `/applications`: pending applications. `POST /applications/:id/approve|decline` updates the status, adds the student as a member with the lowest-rank role (on approval) and sends a notification.
- `/events`: create (`POST /events`), edit (`POST /events/:id`) and delete (`POST /events/:id/delete`) events, as draft or published.
- `/reports`: acceptance rate, event attendance, 6-month member growth. `/reports/export` downloads a CSV.

### routes/portal.js (shared by student and non-member)
Holds everything the two student portals have in common. `routes/student/index.js` and `routes/nonmember/index.js` call `addSharedPages(router, { view, base })` to get Discover, Apply, Events and RSVP without copying code. Exports `UPCOMING`, `getOrgs`, `getUpcomingSummary` and `addSharedPages`.

---

# Function reference

Every function in the backend, one section per file. Browser-side code in `public/js/` is not covered here.

## How to read the database lines

Most of the code talks to MySQL through `db.query(...)`. Once you can read one of these lines, you can read all of them.

### `await db.query(sql, [values])`
- `db.query` sends one SQL statement to MySQL and **waits** for the answer (`await`). It can only be used inside an `async` function.
- Every `?` in the SQL is replaced by the matching item in the `[values]` array. This keeps user input out of the SQL text itself, which prevents SQL injection.
- It always returns an array of **two** things: `[rows, fieldInfo]`. `rows` is the result and `fieldInfo` is column metadata we never use.

### Why the result is written with brackets: `const [[members]] = await ...`

The line selected in `routes/admin/index.js`:

```js
const [[members]] = await db.query('SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?', [
  res.locals.org.id,
]);
```

reads as follows:

| Part | Meaning |
|---|---|
| `SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?` | Count the membership rows of one organization and name the result column `c`. |
| `[res.locals.org.id]` | The value that fills the `?`: the id of the signed-in adviser's organization, loaded earlier by the admin middleware. |
| `await db.query(...)` | Returns `[rows, fieldInfo]`. For this query `rows` is `[ { c: 29 } ]`. |
| outer `[ ... ]` in `const [ ... ]` | Destructuring: take the first item of the returned pair (`rows`) and ignore `fieldInfo`. |
| inner `[ ... ]` | Destructuring again: take the first row of `rows`. |
| `members` | The name given to that first row, so the code can write `members.c` to get 29. |

So `[[members]]` means "first the rows, then the first row". It is used when the query always returns exactly one row, as `COUNT(*)` does.

The other shapes used in the code:

| Written as | Use it when | Example result |
|---|---|---|
| `const [[row]] = await db.query(...)` | One row is expected (a count, or one record by id). `row` is `undefined` if nothing matched. | `row.c`, or `undefined` when the user does not exist |
| `const [rows] = await db.query(...)` | A list of rows is expected (zero or more). | `rows` is an array, for example all events |
| `const [[{ n }]] = ...` | Same as `[[row]]`, then pulls a single column `n` out of that row. | `n` is a number |
| `const [result] = await db.query(INSERT/UPDATE/DELETE ...)` | A write. The result describes the change instead of returning rows. | `result.insertId` (new row id), `result.affectedRows` (rows changed) |
| `[orgs] = await ...` (no `const`) | Reassigns a variable declared earlier with `let`. | used in `loadAccount` |

Related things you will see in the SQL itself:
- `COUNT(*) AS c`: number of rows. `AS c` gives the column a short name.
- `EXISTS(SELECT 1 ...)`: returns 1 if at least one matching row exists, otherwise 0 (used for "saved", "is member").
- `INSERT IGNORE`: insert the row, but silently skip it if it would break a UNIQUE rule (for example joining twice). `affectedRows` is then 0.
- `CURDATE()` is today's date, `NOW()` is the current date and time.

### How the code is written
Only two kinds of functions are used:
- **Traditional declarations** (`function name() {}` and `async function name() {}`) for everything that has a name: helpers, route handlers and middleware.
- **Arrow functions** (`x => ...`) for tiny inline callbacks such as `.map`, `.find` and `.sort`, and for one-line helpers.

Every route file has the same three parts, top to bottom: helpers, then one named handler per page or action, then a **Routes** block at the bottom that lists every URL and the handler it calls, for example `router.get('/members', wrap(showMembers));`. To find out what a URL does, read the Routes block, then jump to the function of that name.

### Other patterns used everywhere
- **`wrap(async (req, res) => { ... })`**: wraps a route handler so that an error inside it is passed to Express's error page instead of crashing the server.
- **`res.locals.x`**: a value stored for the current request. Middleware sets it (for example `res.locals.org`) and later handlers and the EJS views read it.
- **`req.session.user`**: the signed-in user, stored in the session: `{ id, name, role, org_id }`.
- **`flash(req, message, type)`**: stores a message in the session. The next page shows it once as a toast, then it is deleted.
- **`return res.redirect(...)`**: the `return` stops the function, so no code below it runs after the redirect is sent.

---

## utils.js

| Function | What it does |
|---|---|
| `wrap(fn)` | Takes an async route handler and returns a normal Express handler. If the async function throws, the error goes to `next(err)` and shows the 500 page. Used on almost every route. |
| `flash(req, msg, type = 'ok')` | Saves `{ msg, type }` in the session. `type` is `'ok'` (green) or `'err'` (red). Shown on the next page load. |
| `text(value, max)` | Cleans form input: turns it into a string (empty if missing), trims spaces, and cuts it to `max` characters when `max` is given. |
| `cleanEmail(value)` | `text()` plus lowercase, so `Maya@North.edu ` becomes `maya@north.edu`. |
| `derive(password, salt)` | Runs the slow scrypt hash on a password with a salt and returns a Promise of the raw key. Internal. |
| `hashPassword(password)` | Makes a random 16-byte salt, hashes the password with it, and returns `"salt:hexkey"` for storing in `users.password_hash`. |
| `verifyPassword(password, stored)` | Splits `stored` into salt and key, hashes the attempted password with that salt and compares the two with `timingSafeEqual` (a comparison that takes the same time whether or not it matches). Returns `true` or `false`. |
| `pad(n)` | `5` becomes `"05"`. Internal helper for dates. |
| `parseDate(s)` | `"2025-03-07"` (or a longer timestamp) becomes `[2025, 3, 7]`. |
| `fmtShort(s)` | `"2025-03-07"` becomes `"Mar 07"`. |
| `fmtDay(s)` / `fmtMon(s)` | Just the day number (`7`) / just the short month (`"Mar"`). Used for the calendar tiles. |
| `fmtLong(s)` | `"March 7"`. |
| `fmtMonthYear(s)` | `"Mar 2025"`. |
| `fmtTime(t)` | 24-hour time to 12-hour: `"14:30:00"` becomes `"2:30 PM"`. |
| `ymd(d)` | A JavaScript `Date` becomes `"YYYY-MM-DD"` in local time. |
| `initials(name)` | First letters of the first two words, uppercase: `"Maya Alvarez"` becomes `"MA"`. Used for avatars and default logos. |
| `deptAbbr(name)` | Full department name to its abbreviation (`"College of Engineering"` becomes `"COE"`). Unknown names are returned unchanged. |
| `icon(name, size, cls)` | Returns an inline `<svg>` string for a named icon from the `ICONS` table. Views call it as `<%- icon('bell') %>`. |
| `viewHelpers` | An object bundling the functions above that EJS views need. `app.js` copies it into `app.locals` so every view can call them. |

## conn.js
Creates one MySQL connection (`mysql.createConnection`) and exports it. Route files call `.promise()` on it to get the version that works with `await`. No functions of its own.

## app.js
All the code here is middleware (functions that run on each request in the order they are registered).

| Piece | What it does |
|---|---|
| `logDatabaseError` | Registered with `db.on('error', ...)`. Logs a helpful message if MySQL is down or the database is missing. |
| `loadUser` | If the session has a user, re-reads `id, full_name, role, org_id` from the database and refreshes `req.session.user` using `sessionUser(row)`. If the account no longer exists, the session is destroyed. This is why a role change or deleted account takes effect on the very next click. |
| `loadPageValues` | Sets `res.locals.me` (the user), `flash` (the pending toast, then deletes it from the session), `notes` (latest 8 notifications), `unread` (count of unread ones) and `badge` (default 0, overridden by the portals). |
| `markNotificationsRead` | `POST /notifications/read`. Marks all of the signed-in user's notifications as read. Returns `401` JSON if nobody is signed in. |
| `showNotFound` | Any URL no router matched. |
| `showServerError` | The four-parameter error handler `(err, req, res, next)`. Express recognises an error handler by those four parameters and calls it when a handler throws. Logs the error and shows the 500 page. |
| `handleServerError` | Attached with `.on('error', ...)` to the server. If the port is already in use (`EADDRINUSE`), prints how to find and stop the other copy, then exits. |

## routes/auth.js

| Function | What it does |
|---|---|
| `countOrgs(uid)` | Counts the user's rows in `memberships`. 0 means non-member. Uses the `[[row]]` pattern with `COUNT(*)`. |
| `hasStudentInfo(uid)` | Reads `profile_complete` for the user. Returns `true` only if the row exists and the flag is 1. |
| `homeFor(user)` | Decides where a signed-in user belongs: advisers to `/admin`; students without student info to `/student-info`; students with an organization to `/student`; everyone else to `/nonmember`. |
| `sessionUser(row)` | Converts a `users` row into the small object kept in the session (`id`, `name`, `role`, `org_id`). Used at sign-in, sign-up and on every request. |
| `requireAuth` | Guard. No session user means redirect to `/login`. |
| `requireRole(...roles)` | Guard factory. Anonymous goes to `/login`; the wrong role goes to its own `homeFor` page; otherwise continues. Used as `requireRole('adviser')`. |
| `requireNonMember` (wraps `checkNonMember`) | Guard for `/nonmember`. A student who already has an organization is sent to `/student`. |
| `lockNonMembers` (wraps `checkMember`) | Guard for `/student`. A student with no organization is sent to `/nonmember`. |
| `requireStudentInfo` (wraps `checkStudentInfo`) | Guard. A student whose profile is incomplete is sent to `/student-info`. Advisers pass through. |
| `renderAuth(res, mode, error, values, role)` | Renders the sign-in or sign-up page. Sends status 400 if there is an error (200 otherwise) and refills the form with `values`. |
| `redirectSignedInUser` | Middleware for `/`, `/login` and `/register`. Signed-in visitors skip straight to their portal. |
| `validateRegistration(form)` | Checks name and email, email format, password length (6+), organization name for advisers, and that the email is not taken. Returns an error message string, or `null` if everything is fine. |
| `createOrganization(name)` | Inserts a starter organization for a new adviser (random colour, default description, logo from initials) and returns the new `insertId`. |
| `login` | `POST /auth/login`. Cleans the email, looks up the user, checks the password with `verifyPassword`, stores the session and redirects with `homeFor`. The same message is shown for a wrong email or a wrong password so it does not reveal which accounts exist. |
| `register` | `POST /auth/register`. Builds the form object, validates it, creates the organization (advisers only), inserts the user with a hashed password, signs them in and redirects. |
| `logout` | `GET /logout`. Destroys the session and goes to `/`. |

## routes/apply.js

| Function | What it does |
|---|---|
| `applyToOrg(req, res)` | The apply handler for both student portals. In order: not signed in (401), not a student (403), empty intro or no consent (400), organization not found (404), already a member (400), already has a non-rejected application (400). Then it inserts a new application, or re-opens a rejected one as `pending`. Finally it notifies the organization's adviser(s) and replies `{ ok: true, name }` as JSON. The browser script shows the result in the apply popup. |

## routes/portal.js

| Function | What it does |
|---|---|
| `UPCOMING` | Not a function: a SQL snippet, `e.status = 'published' AND e.event_date >= CURDATE()`. It is the single definition of "an event students may see": published and not in the past. It is pasted into queries with `${UPCOMING}`, and `e` is the alias for the `events` table. |
| `getOrgs(uid, search)` | Returns organizations for the card grid. Each row also has `member_count`, `saved` (did this user bookmark it), `app_status` (this user's application status or `NULL`) and `is_member`. When `search` is given, it filters by name, description, tags, category or eligibility using `LIKE`. |
| `getUpcomingSummary(limit)` | Returns `{ total, events }`: how many upcoming events exist, and the next `limit` of them (default 3) with their organization name. Feeds the home page stat and its event list. |
| `getAllCategories()` | Distinct organization categories, used for the filter chips. |
| `addSharedPages(router, { view, base })` | Registers four routes on the router it is given: `GET /discover`, `POST /apply`, `GET /events` (optionally `?org=ID`) and `POST /events/:id/rsvp`. `view` is the view folder to render (`student` or `nonmember`) and `base` is the URL prefix used by the RSVP redirect fallback. |
| `showDiscover`, `showEvents`, `toggleRsvp` (inside `addSharedPages`) | The three handlers it registers; the RSVP one: Toggle: it first tries to delete the RSVP. If nothing was deleted (`affectedRows` is 0), it inserts one, but only for a published event. Then it redirects back to the page the user came from. |

## routes/student/index.js

| Function | What it does |
|---|---|
| `countPending(uid)` | Number of this student's applications with status `pending`. Used for the sidebar badge and the home stat. |
| `loadBadge` | Puts `countPending` into `res.locals.badge` for every student page. |
| `getApplications(uid, limit)` | The student's applications with organization name, logo and colour, newest first. `limit` is optional; the home page asks for 2. |
| `showHome` | `GET /`. Home: all organizations, upcoming summary, the 2 latest applications and the stats (`active` pending, `joined` count, `upcoming`). |
| `showApplications` | `GET /applications`. Application list, plus `byId`, a lookup of organizations by id built with `Object.fromEntries`. |
| `toggleBookmark` | `POST /bookmark/:id`. Toggle: delete the bookmark; if one was deleted reply `{ saved: false }`, else insert it and reply `{ saved: true }`. |
| `showMyOrganizations` | `GET /organizations`. The organizations the student joined, with role, join date and the number of upcoming events for each. |

## routes/nonmember/index.js

| Function | What it does |
|---|---|
| `showHome` | `GET /`. Home for students with no organization: all organizations, the upcoming summary and the stats (`explore` = number of organizations, `upcoming`). |

All other pages of this portal come from `addSharedPages`.

## routes/profile.js

| Function | What it does |
|---|---|
| `choosePortalLayout` | Picks `res.locals.portal`: `admin` for advisers (and loads their organization), `student` for members, otherwise `nonmember`. The views use it to choose the right sidebar or top bar. |
| `readStudentInfo(body)` | Reads and cleans the student fields from a submitted form, each cut to its database column length. |
| `checkStudentInfo(info, uid)` | Validates student ID (pattern and not used by another account), program (from the list), contact number and college. Returns the first error message, or `null`. Bio and year are checked by the callers because the two forms treat them differently. |
| `redirectNonStudent(req, res)` | Advisers cannot use the student form. Sends them to `/admin` and returns `true` so the caller stops. Returns `false` for students. |
| `renderStudentInfo(res, values, error)` | Renders the student information form with its dropdown lists. Status 400 when there is an error. |
| `showStudentInfo` | `GET /student-info`. Shows the form filled with the saved values. |
| `saveStudentInfo` | `POST /student-info`. Validates everything including year level and bio, then saves, sets `profile_complete = 1` and sends the student to their portal. |
| `loadAccount(uid)` | Loads the account row, the adviser's organization name, and a student's memberships. Returns `{ u, orgName, orgs }`, or `null` if the account is gone. |
| `renderAccountPage(req, res, view, page)` | Loads the account and renders `view` with it. If the account was deleted, signs the user out. Shared by Profile and Settings. |
| `backToSettings(req, res, message)` | Flashes an error and redirects to `/settings`. Keeps every validation failure to a single line. |
| `saveProfile` | `POST /profile`. Validates name, email format and email uniqueness. Students also pass through `checkStudentInfo` (an unknown year falls back to 1). Updates the account and the name in the session. |
| `changePassword` | `POST /profile/password`. Requires a new password of 6+ characters that matches the confirmation, checks the current password with `verifyPassword`, then stores `hashPassword(new)`. |

## routes/admin/index.js

| Function | What it does |
|---|---|
| `loadOrganization` | For every admin page: loads the adviser's organization, its roles (ordered by `precedence`) and the pending-application count into `res.locals.org`, `res.locals.orgRoles` and `res.locals.badge`. Signs the user out if the organization is missing. |
| `defaultMemberRole(roles)` | Sorts the roles by precedence, highest number first, and returns the title of the lowest-ranked one (usually `Member`). New members get this role. |
| `addMember(orgId, userId, roleTitle)` | `INSERT IGNORE` into `memberships`. Returns `true` if the row was added and `false` if they were already a member. |
| `notifyUser(userId, message)` | Inserts one row into `notifications`. |
| `countEvents(orgId, extraCondition)` | For one organization's published events, returns `{ events, rsvps }`: how many events and how many RSVPs in total. `extraCondition` lets the caller narrow it, for example to upcoming events only. |
| `orgStats(org)` | Builds the numbers for Overview and Reports: member count, new this month (`fresh`), pending applications, upcoming events and their RSVPs, `attendance` (RSVPs divided by events times members, capped at 100), `acceptance` (approved divided by approved plus rejected) and an overall `score` (the average of attendance, acceptance and satisfaction out of 5, scaled to 100). |
| `memberGrowth(orgId)` | Returns the last 6 months, oldest first, as `{ key, label, count }`, where `count` is how many members joined that month. Months with nobody joining stay at 0. |
| `showOverview` | `GET /`. Overview: stats, the 3 newest applications, the next 5 upcoming events and who is going to the first one. Also builds the greeting from the hour of day. |
| `showOrganization`, `saveOrganization` | `GET` and `POST /organization`. Shows the member count and the edit form. Saving requires a name, restricts category and eligibility to allowed values, and falls back to defaults for logo text and schedule. |
| `showMembers` | `GET /members`. Lists members, optionally filtered by `?q=` on name, email or role. Sorted by role rank, then join date. |
| `inviteMember` | `POST /members/invite`. Finds a student by email, adds them with `addMember` and notifies them. Shows an error if the student does not exist or is already a member. |
| `changeMemberRole` | `POST /members/:mid/role`. Changes a member's role, but only to a title that exists for this organization. |
| `removeMember` | `POST /members/:mid/remove`. Deletes the membership (only within this organization). |
| `showOfficers` | `GET /officers`. Roles plus `useCount`, an object of how many members hold each role, built from a `LEFT JOIN` query. |
| `moveRole(orgId, roles, body)` | Swaps the `precedence` of a role with its neighbour above (`dir=up`) or below. Returns a message such as `Cannot move further.` at the top or bottom. |
| `addRole(orgId, roles, body)` | Adds a new role below all others (`max precedence + 1`). Rejects empty or duplicate titles. |
| `removeRole(orgId, roles, body)` | Deletes a role. Refuses to remove the last role, or one that members still hold. |
| `ROLE_ACTIONS` | A lookup table: `reorder`, `add` and `remove` map to the three functions above. |
| `changeOfficers` | `POST /officers`. Picks the function from `ROLE_ACTIONS` using `req.body.action`. Each function returns `[message, type]`, which is flashed. |
| `showApplications` | `GET /applications`. All applications to this organization with the applicant's details. |
| `reviewApplication` | `POST /applications/:id/:action`. `approve` or `decline` a pending application. Approving also adds the student with `addMember`. Either way the student is notified. Anything already decided is ignored. |
| `showEvents` | `GET /events`. All events of the organization (drafts too) with RSVP counts. |
| `readEvent(body)` | Cleans the event form. Returns `null` if the title is empty or the date or time is malformed, so callers can reject it. Status is `published` or `draft`. |
| `notifyMembers(org, title)` | One `INSERT ... SELECT` that creates a notification for every member of the organization. |
| `createEvent` | `POST /events`. Creates an event. Members are notified only if it is published right away. |
| `updateEvent` | `POST /events/:id`. Edits an event (only within this organization). Members are notified only on the draft-to-published change, so later edits do not spam them. |
| `deleteEvent` | `POST /events/:id/delete`. Deletes an event of this organization. |
| `showReports` | `GET /reports`. `orgStats` plus `memberGrowth`; `max` is the biggest monthly count so the chart bars can be scaled. |
| `exportReport` | `GET /reports/export`. Builds the same numbers as CSV lines, sets the download headers and sends the file. The file name comes from the organization name. |

## setup.js

| Function | What it does |
|---|---|
| `addDays(n)` | Today plus `n` days as `YYYY-MM-DD`. Negative numbers give past dates, which is how the demo data gets realistic dates. |
| `insert(sql, params)` | Runs an INSERT and returns the new row's id. |
| `addOrg(o)`, `addUser(...)`, `addMember(...)`, `addApplication(...)`, `addEvent(...)`, `addNotification(...)` | Small wrappers around one INSERT each, so the seed data below reads as a list of facts. `addUser` hashes the password `"password"` with its own salt. |
| `seed()` (called by `main()`) | Connects, drops and recreates the database, creates the tables from `SCHEMA`, then seeds organizations, roles, users, memberships, applications, events, RSVPs and notifications. |

---

## Database (MySQL, `fourloop_db`)

| Table | Purpose |
|---|---|
| **organizations** | Name, description, category, tags, eligibility (International or one department), colors and logo, meeting schedule, satisfaction score. |
| **users** | Students and advisers: name, unique email, password hash, role, student ID, program, year, contact, college, bio, hobbies, `profile_complete`, and `org_id` (the organization an adviser runs). |
| **memberships** | Which user belongs to which organization, with `role_title` and `joined_at`. |
| **org_roles** | The officer hierarchy per organization (`role_title`, `precedence`, `is_officer`). Created by `setup.js` and `database.sql`. |
| **applications** | A student's application to an organization (intro, status: pending, approved or rejected, reviewed time). |
| **events** | An organization's events (date, time, location, description, draft or published status). |
| **rsvps** | Which user RSVP'd to which event. |
| **bookmarks** | Organizations a student has saved. |
| **notifications** | Messages shown in the bell dropdown, with read/unread state. |

---

## views/ (the pages the backend renders)

| Folder | Contents |
|---|---|
| **views/shared/** | Pages and partials used by every portal: `index.ejs` (landing page), `auth.ejs` (sign-in and sign-up), `student-info.ejs`, `profile.ejs`, `settings.ejs`, and the `head`, `foot`, `logo` and `tools` partials (theme toggle, bell, avatar, search). |
| **views/student/** | Member portal: home, discover, applications, events and organizations, plus `partials/` (top bar, bottom, org card, apply modal). |
| **views/nonmember/** | Limited portal: home, discover, events and `partials/`. |
| **views/admin/** | Adviser portal: overview, organization, members, officers, applications, events and reports, plus `partials/` (sidebar and top bar). |

## public/ (static files sent as-is)
- **public/css/**: `shared/base.css` (variables, buttons, forms, landing page, modals, dark mode), `student/student.css` and `admin/admin.css`.
- **public/js/**: `shared/common.js` (theme, dropdowns, shortcuts, tabs, modals, toast), `student/student.js` (filter chips, bookmarks, apply popup) and `admin/admin.js` (event popup, organization preview, mobile drawer). This is browser-side code, not backend.
- **public/pic/**: `logo.png`.

## docs/
Project notes: `spec.md`, `spec-events.md`, `spec-nonmember.md`, `progress.md` and `prompt.md`.

---

## Security notes
- Passwords are never stored in plain text. Each uses a random salt and the scrypt hash.
- The role comes from the database on every request, not from the cookie.
- Each portal is protected by role guards, and advisers can only manage their own organization.
- SQL queries use `?` placeholders to prevent SQL injection.
- The session secret comes from `SESSION_SECRET`, with a development fallback in `app.js`.
