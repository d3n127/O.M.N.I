# Implementation Prompt — Events Dashboards + Non-Member Portal

> Copy-paste this file (or its §Prompt block) to a coding agent to implement the two
> approved specs. It is written against the 4loopGroup codebase (`forloop/`).

---

## Prompt

You are implementing two approved features in the **4loopGroup** portal — an Express 4 + EJS 3 + MySQL (mysql2) server-rendered app located in `forloop/`. There is **no build step**; follow the existing code style exactly (`wrap()` async handlers, `requireRole` gates, `flash()` messages, parameterized queries, `app.locals` view helpers).

**Read these first, in order:**

1. `docs/spec-events.md` — Feature 1: event creation formalized + NEW officer-overview event list.
2. `docs/spec-nonmember.md` — Feature 2: NEW `/nonmember` portal for students with 0 memberships.
3. `docs/spec.md` §5 — baseline FR conventions (`FR-<AREA>-<n>` tables) you must stay consistent with.
4. The files you will touch (listed in §Task 1.4 / §Task 2.4 of each spec).

**Ground rules**

- Implement **only** what the two specs require. Do not refactor unrelated code, do not touch `docs/spec.md` or `docs/progress.md`, do not add dependencies, do not create migrations or change the schema (both specs have *Data model impact: None*).
- Keep baseline behavior intact: existing FR-STUDENT-3 validation messages/bodies, `UPCOMING` predicate (`e.status = 'published' AND e.event_date >= CURDATE()`), org-scoped writes, session shape `{ id, name, role, org_id }`.
- Match existing conventions: route handlers wrapped in `wrap(async …)`, errors → `flash(req, msg, 'err')` or `res.status(4xx).json({ error })`, views reuse existing CSS classes and `fmt*`/`icon()` helpers.

---

### Task 1 — Event creation & dashboard display (per `docs/spec-events.md`)

1. **Formalized parts (FR-EVENTS-1…6): verify, don't rewrite.** Confirm `/admin/events` CRUD, `readEvent()` validation, publish notifications, `?new=1`, and student home's next-3 list already match the spec. Fix only genuine mismatches (e.g., missing org scoping or a wrong message). Expect zero or near-zero changes here.
2. **New code (FR-EVENTS-7):** in `routes/admin/index.js`'s `GET /admin` handler, query up to the next **5** events for the officer's org matching the `UPCOMING` predicate, ordered by `event_date, event_time`, each with an RSVP count (correlated subquery, mirroring the existing `/admin/events` list query). Pass them to the view.
3. **View:** in `views/admin/overview.ejs`, render an *Upcoming events* section **below** the existing featured-event block — rows reuse the `.ev-admin` markup / `.date-tile` styling from `views/admin/events.ejs`: date tile, title, time · location, RSVP count, *Manage* link → `/admin/events`. Include the empty state (*Nothing scheduled yet* + *Create event* link → `/admin/events?new=1`). Add CSS to `public/css/admin/admin.css` only if spacing on the overview canvas requires it.
4. **Check off** acceptance criteria AC-1…AC-8 from `docs/spec-events.md` (draft invisibility, past-event exclusion, publish-once notification, 5-row cap, empty state, foreign-org no-write).

### Task 2 — Non-member portal (per `docs/spec-nonmember.md`)

1. **Gate helpers** in `middleware.js`: membership count check (`SELECT COUNT(*) FROM memberships WHERE user_id = ?`), a non-member gate for the new router (member → redirect `/student`), and a member lock for `/student` (0 orgs → redirect `/nonmember`). Both run after `requireRole('student')`.
2. **Auth landing** in `routes/auth.js`: make `home()` membership-aware — student with 0 memberships → `/nonmember`, ≥1 → `/student`, admin → `/admin`. Apply to `GET /`, `POST /auth/login`, and `POST /auth/register`.
3. **New folder** `routes/nonmember/index.js` with five routes: `GET /` (limited home: org cards, explore/upcoming counts, next 3 events, category chips), `GET /discover?q=`, `POST /apply` (validation **identical** to FR-STUDENT-3 — share a helper if practical), `GET /events?org=`, `POST /events/:id/rsvp` (publish-state guard). Attach the non-member gate.
4. **New views** `views/nonmember/{home,discover,events}.ejs` + `partials/{top,bottom}.ejs`: reduced nav (Home · Discover · Events, no Applications badge), search form posting to `/nonmember/discover`, reusing `views/student/partials/orgcard.ejs` and `apply_modal.ejs` **as-is** (org profile = card + modal; no dedicated profile page; no bookmark control offered).
5. **Mount** `app.use('/nonmember', require('./routes/nonmember'))` in `app.js`. Add `lockNonMembers` to `routes/student/index.js`.
6. **Parameterize client JS:** in `public/js/student/student.js`, replace the hardcoded `/student/apply` fetch with `fetch(form.dataset.endpoint || '/student/apply', …)`; set `data-endpoint="/nonmember/apply"` on the apply form in nonmember views. (Bookmark fetch stays as-is — nonmember views simply never render a working save control.)
7. **Check off** acceptance criteria AC-1…AC-10 from `docs/spec-nonmember.md`, especially the lifecycle transitions (approval → auto-graduation to `/student`; removal from last org → bounce to `/nonmember`) and the negative cases (admin/member/anonymous visits).

### Definition of done

- Both specs' acceptance tables pass against a seeded database (`npm run setup` → `npm start`).
- No schema changes, no new dependencies, no edits to `docs/spec.md` / `docs/progress.md` / baseline routes beyond the gates and hooks listed above.
- Existing portals behave exactly as before for: members on `/student`, officers on `/admin`, and all baseline FRs.
- List every file created/modified and map each change to its FR ID in your final summary.

---

## Spec ↔ task traceability

| Spec | FRs | New code? | Primary files |
| --- | --- | --- | --- |
| `docs/spec-events.md` | FR-EVENTS-1…6 | No — verify only | `routes/admin/index.js`, `routes/student/index.js`, `views/admin/events.ejs`, `views/student/home.ejs` |
| `docs/spec-events.md` | FR-EVENTS-7 | **Yes** | `routes/admin/index.js` (GET /admin), `views/admin/overview.ejs`, `public/css/admin/admin.css` |
| `docs/spec-nonmember.md` | FR-NONMEMBER-1…5 | **Yes** | `routes/nonmember/index.js` (new), `views/nonmember/*` (new) |
| `docs/spec-nonmember.md` | FR-NONMEMBER-6 | **Yes** | `middleware.js`, `routes/auth.js`, `routes/student/index.js`, `app.js` |
| `docs/spec-nonmember.md` | FR-NONMEMBER-7 | No — existing global middleware | — |
| Shared | §6 JS parameterization | **Yes** | `public/js/student/student.js` |
