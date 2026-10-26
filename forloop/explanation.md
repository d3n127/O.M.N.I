# O.M.N.I Backend Explanation

The backend is a Node.js server built with **Express**. It renders pages with **EJS** templates and stores data in **MySQL** (database `fourloop_db`). This document explains what each file and folder does.

## Request flow

```
Browser -> app.js (middleware) -> routes/<area> -> MySQL (conn.js) -> views/<area>.ejs -> HTML back to the browser
```

1. `app.js` receives every request. It loads the session and the signed-in user, then sets values every page uses.
2. The request is passed to a router in `routes/`.
3. The router checks the user's role, queries MySQL and renders an EJS view, or redirects.
4. Database calls use **callbacks** (no `async` / `await`): the handler passes MySQL a function to run when the answer is ready, and renders the page from inside it. See "How to read the database lines" below.

---

## Root files

| File | What it does |
|---|---|
| **app.js** | Entry point. Sets up Express, EJS, static files and sessions (8-hour cookie). Runs two middleware on every request: `loadUser` re-reads the user and role from the DB, so role changes and deleted accounts apply immediately. The second sets `me`, the flash message, the latest 8 notifications and the unread count for the views. It then mounts the routers, defines `POST /notifications/read`, adds the 404 and 500 handlers, and starts the server on port 3000 (with a clear message if the port is taken). |
| **conn.js** | Creates the MySQL connection (user `root`, host `localhost`, empty password, database `fourloop_db`). Every route file imports it. |
| **utils.js** | Shared helpers: `series` and `parallel` (run callbacks in order or together), `flash` (one-time toast message), `ROLES` (`student`, `adviser`), `hashPassword` / `verifyPassword` (random salt + scrypt, stored as `salt:hexkey`), date helpers, the `DEPARTMENTS` list with abbreviations, and the inline SVG `icon()` used in views. |
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
  - `homeFor` and `countOrgs`: decide where a user belongs (advisers go to `/admin`). `redirectHome` sends the user there.

### routes/profile.js (shared account pages)
- `GET/POST /student-info`: the required student information form shown right after registering. Students only.
- `GET /profile`: read-only profile with the student's organizations.
- `GET /settings`: the settings page.
- `POST /profile`: edit profile details. The email must be unique across all roles.
- `POST /profile/password`: change password.
- It chooses which portal layout to render in (admin sidebar, student top bar or nonmember top bar). Its guards are scoped to these paths only, because the router is mounted at `/`.

### routes/apply.js (shared helper)
`applyToOrg` is used by both `/student/apply` and `/nonmember/apply`. It accepts students only, requires an intro and consent, rejects unknown organizations and existing members, and blocks duplicate applications unless the earlier one was rejected. Otherwise it creates or resubmits the application (`saveApplication`) and notifies the adviser, so both portals behave identically.

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

Reading tip: a function whose last parameter is `done` reads the database and answers through `done(err, result)`. A route handler has the parameters `(req, res, next)` and answers by rendering, redirecting or calling `next(err)`.

## How to read the database lines

Most of the code talks to MySQL through `db.query(...)`. The code does not use `async` / `await`. Instead, every database call takes a **callback**: a function that MySQL calls when the answer is ready. Once you can read one of these calls, you can read all of them.

### `db.query(sql, [values], callback)`
- `db.query` sends one SQL statement to MySQL. It returns immediately; the code after it does **not** wait. MySQL calls the callback later, when the result is ready. Everything that needs the result must therefore be written **inside** the callback.
- Every `?` in the SQL is replaced by the matching item in the `[values]` array. This keeps user input out of the SQL text itself, which prevents SQL injection.
- The callback always receives `(err, result)`:
  - `err` is `null` when everything worked, or an error object when it did not. **Always check it first.**
  - `result` is the data (see the shapes below).

### Reading your selected example

```js
db.query(
  'SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?',
  [res.locals.org.id],
  (err, rows) => {
    if (err) {
      return next(err);
    }
    res.render('admin/organization', { memberCount: rows[0].c, ... });
  },
);
```

| Part | Meaning |
|---|---|
| `SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?` | Count the membership rows of one organization and name the result column `c`. |
| `[res.locals.org.id]` | The value that fills the `?`: the id of the signed-in adviser's organization, loaded earlier by the admin middleware. |
| `(err, rows) => { ... }` | The callback. MySQL runs it when the count is ready. |
| `if (err) { return next(err); }` | If the query failed, hand the error to Express's error page and stop. The `return` makes sure the lines below do not run. |
| `rows` | A `SELECT` always gives an **array of rows**. For this query it is `[ { c: 29 } ]`. |
| `rows[0].c` | The first row, then its `c` column: `29`. A `COUNT(*)` always returns exactly one row, so `rows[0]` is always there. |

### The shapes `result` can have

| Query type | `result` is | How the code reads it |
|---|---|---|
| `SELECT` that can return many rows | an array of row objects | `rows.map(...)`, or passed straight to a view (for example all events) |
| `SELECT` for one record by id | an array with 0 or 1 row | `rows[0]`, or `rows.length` to test whether it exists |
| `SELECT COUNT(*) AS c ...` | an array with exactly 1 row | `rows[0].c` |
| `INSERT` / `UPDATE` / `DELETE` | an object describing the change | `result.insertId` (new row id) and `result.affectedRows` (rows changed) |

Related things you will see in the SQL itself:
- `COUNT(*) AS c`: number of rows. `AS c` gives the column a short name.
- `EXISTS(SELECT 1 ...)`: returns 1 if at least one matching row exists, otherwise 0 (used for "saved", "is member").
- `INSERT IGNORE`: insert the row, but silently skip it if it would break a UNIQUE rule (for example joining twice). `affectedRows` is then 0.
- `CURDATE()` is today's date, `NOW()` is the current date and time.

### Functions that return results through a callback
A function that reads the database cannot `return` the answer, because the answer does not exist yet when the function ends. So it takes one extra last parameter, `done`, and calls it with the answer:

```js
function countOrgs(uid, done) {
  db.query('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?', [uid], (err, rows) => {
    if (err) {
      return done(err);              // pass the error on
    }
    done(null, Number(rows[0].c));   // success: no error, here is the number
  });
}

countOrgs(7, (err, count) => { ... });  // how a caller uses it
```

Every such function in this project follows the same rule: **`done(err, result)`**. On success `err` is `null`. In a route handler, `next(err)` plays the same role: it sends the error to the 500 page.

### Running several queries
- **One after another** (the second needs the first's answer): put the second query *inside* the first one's callback. This is what makes some handlers nest.
- **At the same time** (they do not depend on each other): `parallel({ name: (cb) => ..., ... }, (err, results) => ...)` from `utils.js`. It starts all the tasks, waits for every one, and gives back `results.name` for each. Used for pages that need several independent lookups.
- **A fixed list in order**: `series([step1, step2, ...], done)` from `utils.js`. Used by `setup.js`.

### How the code is written
Only two kinds of functions are used, and there is no `async` / `await`:
- **Traditional declarations** (`function name() {}`) for everything that has a name: helpers, route handlers and middleware.
- **Arrow functions** (`(err, rows) => { ... }`) for the callbacks passed to `db.query`, `parallel` and `series`, and for tiny helpers such as `.map` and `.find` callbacks.

Every route file has the same three parts, top to bottom: helpers, then one named handler per page or action, then a **Routes** block at the bottom that lists every URL and the handler it calls, for example `router.get('/members', showMembers);`. To find out what a URL does, read the Routes block, then jump to the function of that name.

### Other patterns used everywhere
- **`(req, res, next)`**: every route handler and middleware gets these three. `next()` continues to the next handler; `next(err)` jumps to the error page.
- **`res.locals.x`**: a value stored for the current request. Middleware sets it (for example `res.locals.org`) and later handlers and the EJS views read it.
- **`req.session.user`**: the signed-in user, stored in the session: `{ id, name, role, org_id }`.
- **`flash(req, message, type)`**: stores a message in the session. The next page shows it once as a toast, then it is deleted.
- **`return res.redirect(...)`**: the `return` stops the function, so no code below it runs after the redirect is sent.

---

## utils.js

| Function | What it does |
|---|---|
| `series(steps, done)` | Runs a list of functions one after another. Each step is a function that takes a callback and calls it when finished. Stops at the first error. `done(err)` is called at the end. Used by `setup.js`. |
| `parallel(tasks, done)` | Starts several tasks at once, waits for all of them, and calls `done(err, results)` where `results.name` holds each task's answer. Stops at the first error. |
| `runNext(err)` (inside `series`) | Runs the next step in the list. It is passed to every step as its callback, so a finished step starts the one after it. It stops on the first error or when the list ends. |
| `flash(req, msg, type = 'ok')` | Saves `{ msg, type }` in the session. `type` is `'ok'` (green) or `'err'` (red). Shown on the next page load. |
| `text(value, max)` | Cleans form input: turns it into a string (empty if missing), trims spaces, and cuts it to `max` characters when `max` is given. |
| `cleanEmail(value)` | `text()` plus lowercase, so `Maya@North.edu ` becomes `maya@north.edu`. |
| `hashPassword(password, done)` | Makes a random 16-byte salt, hashes the password with it, and calls `done(err, "salt:hexkey")` for storing in `users.password_hash`. |
| `verifyPassword(password, stored, done)` | Splits `stored` into salt and key, hashes the attempted password with that salt and compares the two with `timingSafeEqual` (a comparison that takes the same time whether or not it matches). Calls `done(err, true | false)`. |
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
Creates one MySQL connection (`mysql.createConnection`) and exports it. Every file uses it directly with callbacks: `db.query(sql, values, callback)`. No functions of its own.

## app.js
All the code here is middleware (functions that run on each request in the order they are registered).

| Piece | What it does |
|---|---|
| `logDatabaseError` | Registered with `db.on('error', ...)`. Logs a helpful message if MySQL is down or the database is missing. |
| `loadUser` | If the session has a user, re-reads `id, full_name, role, org_id` from the database and refreshes `req.session.user` using `sessionUser(row)`. If the account no longer exists, the session is destroyed. This is why a role change or deleted account takes effect on the very next click. |
| `loadPageValues` | Sets `res.locals.me` (the user), `flash` (the pending toast, then deletes it from the session), `notes` (latest 8 notifications), `unread` (count of unread ones) and `badge` (default 0, overridden by the portals). The notes and the unread count are fetched together with `parallel`. |
| `markNotificationsRead` | `POST /notifications/read`. Marks all of the signed-in user's notifications as read. Returns `401` JSON if nobody is signed in. |
| `showNotFound` | Any URL no router matched. |
| `showServerError` | The four-parameter error handler `(err, req, res, next)`. Express recognises an error handler by those four parameters and calls it when a handler throws. Logs the error and shows the 500 page. |
| `announceStart` | Prints the "running at http://localhost:PORT" line once the server is listening. |
| `handleServerError` | Attached with `.on('error', ...)` to the server. If the port is already in use (`EADDRINUSE`), prints how to find and stop the other copy, then exits. |

## routes/auth.js

| Function | What it does |
|---|---|
| `countOrgs(uid, done)` | Counts the user's rows in `memberships`. 0 means non-member. Reads `rows[0].c` from a `COUNT(*)` query and calls `done(null, number)`. |
| `hasStudentInfo(uid, done)` | Reads `profile_complete` for the user and calls `done(null, true | false)`: `true` only if the row exists and the flag is 1. |
| `homeFor(user, done)` | Decides where a signed-in user belongs and calls `done(null, url)`: advisers to `/admin`; students without student info to `/student-info`; students with an organization to `/student`; everyone else to `/nonmember`. |
| `redirectHome(user, res, next)` | Calls `homeFor` and then redirects to the result. Used after sign-in, sign-up and on the public pages. |
| `sessionUser(row)` | Converts a `users` row into the small object kept in the session (`id`, `name`, `role`, `org_id`). Used at sign-in, sign-up and on every request. |
| `requireAuth` | Guard. No session user means redirect to `/login`. |
| `requireRole(...roles)` | Guard factory: it returns the guard function. Anonymous goes to `/login`; the wrong role goes to its own portal (`redirectHome`); otherwise continues. Used as `requireRole('adviser')`. |
| `requireNonMember` | Guard for `/nonmember`. A student who already has an organization is sent to `/student`. |
| `lockNonMembers` | Guard for `/student`. A student with no organization is sent to `/nonmember`. |
| `requireStudentInfo` | Guard. A student whose profile is incomplete is sent to `/student-info`. Advisers pass through. |
| `renderAuth(res, mode, error, values, role)` | Renders the sign-in or sign-up page. Sends status 400 if there is an error (200 otherwise) and refills the form with `values`. |
| `redirectSignedInUser` | Middleware for `/`, `/login` and `/register`. Signed-in visitors skip straight to their portal. |
| `showLanding`, `showLogin`, `showRegister` | `GET /`, `GET /login` and `GET /register`. They render the landing page and the sign-in / sign-up form (`?role=adviser` pre-selects the adviser tab). |
| `redirectOldLoginUrl` | The old `/login/:role` URLs redirect to `/login` or `/register`. |
| `validateRegistration(form, done)` | Checks name and email, email format, password length (6+), organization name for advisers, and that the email is not taken. Calls `done(null, message)` with an error text, or `done(null, null)` if everything is fine. |
| `createOrganization(name, done)` | Inserts a starter organization for a new adviser (random colour, default description, logo from initials) and calls `done(null, newOrgId)`. |
| `createOrganizationIfAdviser(form, done)` | Calls `createOrganization` for advisers. For students it skips it and calls `done(null, null)`, because a student's organization name is ignored. |
| `login` | `POST /auth/login`. Cleans the email, looks up the user, checks the password with `verifyPassword`, stores the session and redirects with `redirectHome`. The same message is shown for a wrong email or a wrong password so it does not reveal which accounts exist. |
| `showWrongPassword` (inside `login`) | Re-renders the sign-in page with the single "Incorrect email or password" message. Used for an unknown email and for a wrong password alike. |
| `register` | `POST /auth/register`. Builds the form object, validates it, creates the organization (advisers only), inserts the user with a hashed password, signs them in and redirects. |
| `logout` | `GET /logout`. Destroys the session and goes to `/`. |

## routes/apply.js

| Function | What it does |
|---|---|
| `applyToOrg(req, res, next)` | The apply handler for both student portals. In order: not signed in (401), not a student (403), empty intro or no consent (400), organization not found (404), already a member (400), already has a non-rejected application (400). Then it inserts a new application, or re-opens a rejected one as `pending`. Finally it notifies the organization's adviser(s) and replies `{ ok: true, name }` as JSON. The browser script shows the result in the apply popup. |
| `saveApplication(existing, orgId, userId, intro, done)` | Re-opens a rejected application as `pending` (when `existing` is given), or inserts a new one. |

## routes/portal.js

| Function | What it does |
|---|---|
| `UPCOMING` | Not a function: a SQL snippet, `e.status = 'published' AND e.event_date >= CURDATE()`. It is the single definition of "an event students may see": published and not in the past. It is pasted into queries with `${UPCOMING}`, and `e` is the alias for the `events` table. |
| `getOrgs(uid, search, done)` | Calls `done(err, orgs)` with the organizations for the card grid. Each row also has `member_count`, `saved` (did this user bookmark it), `app_status` (this user's application status or `NULL`) and `is_member`. When `search` is not empty, it filters by name, description, tags, category or eligibility using `LIKE`. Pass `''` for no search. |
| `getUpcomingSummary(limit, done)` | Calls `done(err, { total, events })`: how many upcoming events exist, and the next `limit` of them with their organization name. Runs both queries with `parallel`. Feeds the home page stat and its event list. |
| `getAllCategories(done)` | Distinct organization categories, used for the filter chips. |
| `addSharedPages(router, { view, base })` | Registers four routes on the router it is given: `GET /discover`, `POST /apply`, `GET /events` (optionally `?org=ID`) and `POST /events/:id/rsvp`. `view` is the view folder to render (`student` or `nonmember`) and `base` is the URL prefix used by the RSVP redirect fallback. |
| `showDiscover`, `showEvents`, `toggleRsvp` (inside `addSharedPages`) | The page handlers it registers. `showDiscover` and `showEvents` fetch their data with `parallel`. `toggleRsvp` is a toggle: it first tries to delete the RSVP. If nothing was deleted (`affectedRows` is 0), it inserts one, but only for a published event. Then it redirects back to the page the user came from. |
| `getFilterName(orgId, done)` (inside `addSharedPages`) | The organization's name for the `?org=ID` filter on the Events page, or `null` when there is no filter. |
| `backToPage` (inside `toggleRsvp`) | Redirects back to the page the user came from (the `Referer`), or to the portal's events page. |

## routes/student/index.js

| Function | What it does |
|---|---|
| `countPending(uid, done)` | Number of this student's applications with status `pending`. Used for the sidebar badge and the home stat. |
| `loadBadge` | Puts `countPending` into `res.locals.badge` for every student page. |
| `getApplications(uid, limit, done)` | The student's applications with organization name, logo and colour, newest first. `limit` is how many to return (the home page asks for 2); pass `0` for all. |
| `showHome` | `GET /`. Home: all organizations, upcoming summary, the 2 latest applications and the stats (`active` pending, `joined` count, `upcoming`), fetched together with `parallel`. |
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
| `checkStudentInfo(info, uid, done)` | Validates student ID (pattern and not used by another account), program (from the list), contact number and college. Calls `done(null, message)` with the first error, or `done(null, null)`. Bio and year are checked by the callers because the two forms treat them differently. |
| `redirectNonStudent(req, res)` | Advisers cannot use the student form. Sends them to `/admin` and returns `true` so the caller stops. Returns `false` for students. |
| `renderStudentInfo(res, values, error)` | Renders the student information form with its dropdown lists. Status 400 when there is an error. |
| `showStudentInfo` | `GET /student-info`. Shows the form filled with the saved values. |
| `saveStudentInfo` | `POST /student-info`. Validates everything including year level and bio, then saves, sets `profile_complete = 1` and sends the student to their portal. |
| `loadOrgName(user, done)` | The adviser's organization name, or `null` for students. |
| `loadMemberships(user, done)` | A student's organizations with role and join date (an empty list for advisers). |
| `loadAccount(uid, done)` | Loads the account row, then `loadOrgName` and `loadMemberships`. Calls `done(null, { u, orgName, orgs })`, or `done(null, null)` if the account is gone. |
| `renderAccountPage(req, res, next, view, page)` | Loads the account and renders `view` with it. If the account was deleted, signs the user out. Shared by Profile and Settings. |
| `showProfile`, `showSettings` | `GET /profile` and `GET /settings`. Both call `renderAccountPage`; Settings also passes the program and department lists for the edit form. |
| `backToSettings(req, res, message)` | Flashes an error and redirects to `/settings`. Keeps every validation failure to a single line. |
| `saveProfile` | `POST /profile`. Validates name, email format and email uniqueness, then calls `saveProfileChanges`. |
| `saveProfileChanges(req, res, next, name, email)` | Saves the new name and email. Students also pass through `checkStudentInfo` (an unknown year falls back to 1) and their student fields are saved too. Updates the name in the session. |
| `finish(err)` (inside `saveProfileChanges`) | Shared last step of the profile save: reports an error, or updates the session name, flashes "Profile updated." and redirects to Settings. |
| `changePassword` | `POST /profile/password`. Requires a new password of 6+ characters that matches the confirmation, checks the current password with `verifyPassword`, then stores `hashPassword(new)`. |

## routes/admin/index.js

| Function | What it does |
|---|---|
| `loadOrganization` | For every admin page: loads the adviser's organization, its roles (ordered by `precedence`) and the pending-application count into `res.locals.org`, `res.locals.orgRoles` and `res.locals.badge`. Signs the user out if the organization is missing. The roles and the badge count are fetched together with `parallel`. |
| `defaultMemberRole(roles)` | Sorts the roles by precedence, highest number first, and returns the title of the lowest-ranked one (usually `Member`). New members get this role. |
| `addMember(orgId, userId, roleTitle, done)` | `INSERT IGNORE` into `memberships`. Calls `done(null, true)` if the row was added and `done(null, false)` if they were already a member. |
| `notifyUser(userId, message, done)` | Inserts one row into `notifications`. |
| `countEvents(orgId, extraCondition, done)` | For one organization's published events, calls `done(err, { events, rsvps })`: how many events and how many RSVPs in total. `extraCondition` lets the caller narrow it, for example to upcoming events only. |
| `orgStats(org, done)` | Runs its five queries together with `parallel`, then builds the numbers for Overview and Reports: member count, new this month (`fresh`), pending applications, upcoming events and their RSVPs, `attendance` (RSVPs divided by events times members, capped at 100), `acceptance` (approved divided by approved plus rejected) and an overall `score` (the average of attendance, acceptance and satisfaction out of 5, scaled to 100). |
| `memberGrowth(orgId, done)` | Calls `done(err, months)` with the last 6 months, oldest first, as `{ key, label, count }`, where `count` is how many members joined that month. Months with nobody joining stay at 0. |
| `showOverview` | `GET /`. Overview: stats, the 3 newest applications and the next 5 upcoming events (fetched together with `parallel`), then who is going to the first one (a second query that needs the first result). Also builds the greeting from the hour of day. |
| `renderOverview(going)` (inside `showOverview`) | Builds the greeting from the hour of day and renders the Overview page once the list of people going to the featured event is known. |
| `showOrganization`, `saveOrganization` | `GET` and `POST /organization`. Shows the member count and the edit form. Saving requires a name, restricts category and eligibility to allowed values, and falls back to defaults for logo text and schedule. |
| `showMembers` | `GET /members`. Lists members, optionally filtered by `?q=` on name, email or role. Sorted by role rank, then join date. |
| `inviteMember` | `POST /members/invite`. Finds a student by email, adds them with `addMember` and notifies them. Shows an error if the student does not exist or is already a member. |
| `changeMemberRole` | `POST /members/:mid/role`. Changes a member's role, but only to a title that exists for this organization. |
| `removeMember` | `POST /members/:mid/remove`. Deletes the membership (only within this organization). |
| `showOfficers` | `GET /officers`. Roles plus `useCount`, an object of how many members hold each role, built from a `LEFT JOIN` query. |
| `moveRole(orgId, roles, body, done)` | Swaps the `precedence` of a role with its neighbour above (`dir=up`) or below. Calls `done(null, [message, type])`, for example `Cannot move further.` at the top or bottom. |
| `addRole(orgId, roles, body, done)` | Adds a new role below all others (`max precedence + 1`). Rejects empty or duplicate titles. |
| `removeRole(orgId, roles, body, done)` | Deletes a role. Refuses to remove the last role, or one that members still hold. |
| `ROLE_ACTIONS` | A lookup table: `reorder`, `add` and `remove` map to the three functions above. |
| `changeOfficers` | `POST /officers`. Picks the function from `ROLE_ACTIONS` using `req.body.action`. Each function calls `done(err, [message, type])`, and that message is flashed. |
| `showApplications` | `GET /applications`. All applications to this organization with the applicant's details. |
| `reviewApplication` | `POST /applications/:id/:action`. `approve` or `decline` a pending application. The steps run in order: update the status, add the student with `addMember` (approve only), then notify the student. Anything already decided is ignored. |
| `notifyStudent` (inside `reviewApplication`) | The last step of a review: sends the accepted or declined notification, flashes the result and redirects to the applications list. |
| `showEvents` | `GET /events`. All events of the organization (drafts too) with RSVP counts. |
| `readEvent(body)` | Cleans the event form. Returns `null` if the title is empty or the date or time is malformed, so callers can reject it. Status is `published` or `draft`. |
| `notifyMembers(org, title, done)` | One `INSERT ... SELECT` that creates a notification for every member of the organization. |
| `createEvent` | `POST /events`. Creates an event. Members are notified only if it is published right away. |
| `updateEvent` | `POST /events/:id`. Edits an event (only within this organization). Members are notified only on the draft-to-published change, so later edits do not spam them. |
| `finish` (inside `updateEvent`) | Flashes "Event saved." and redirects to the events list. It runs right after the update, or after members have been notified. |
| `deleteEvent` | `POST /events/:id/delete`. Deletes an event of this organization. |
| `showReports` | `GET /reports`. `orgStats` plus `memberGrowth`; `max` is the biggest monthly count so the chart bars can be scaled. |
| `exportReport` | `GET /reports/export`. Builds the same numbers as CSV lines, sets the download headers and sends the file. The file name comes from the organization name. |

## setup.js

| Function | What it does |
|---|---|
| `addDays(n)` | Today plus `n` days as `YYYY-MM-DD`. Negative numbers give past dates, which is how the demo data gets realistic dates. |
| `queue(sql, params, key)` | Does not run the SQL yet: it adds a step to the list. When that step runs, the new row's id is saved as `ids[key]` so later steps can use it (`params` can be a function so it reads ids at run time). |
| `addOrg(o)`, `addUser(...)`, `addMember(...)`, `addApplication(...)`, `addEvent(...)`, `addNotification(...)` | Each one queues a single INSERT, so the seed data below reads as a list of facts. `addUser` hashes the password `"password"` with its own salt. |
| `seed(done)` | Queues every step (create the database and tables, then organizations, roles, users, memberships, applications, events, RSVPs and notifications), then runs them in order with `series`. |

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
