# 4loopGroup — Progress Report

**Project:** 4loopGroup v1.0.0 — student organization portal (Express + EJS + MySQL)
**Report date:** 19 October 2026
**Baseline commit:** `0f71571` "initail commit" (branch `main`, single commit, no tags)
**Companion document:** [`docs/spec.md`](./spec.md)

---

## 1. Summary

Version 1.0.0 is a **functional MVP**: both portals run end-to-end against a seeded MySQL database,
covering every functional requirement in the specification (FR-AUTH-1…6, FR-STUDENT-1…7,
FR-ADMIN-1…10, FR-NOTIFY-1…3). The deliverable is a single npm-installable app with no build step.

**Assessment method:** this report is based on a **code review of the repository only**. The
application was not booted and the database was not created while preparing this document, so
"completed" means *implemented and self-consistent in code*, not *runtime-verified*. Section 3 lists
the checks that remain outstanding.

| Area | State | Coverage |
| --- | --- | --- |
| Data layer + seeder | Complete | 8 tables, demo data |
| Authentication & sessions | Complete | FR-AUTH-1…6 |
| Student portal | Complete | FR-STUDENT-1…7 |
| Officer (admin) portal | Complete | FR-ADMIN-1…10 |
| Notifications & flash messaging | Complete | FR-NOTIFY-1…3 |
| UI (EJS + CSS + JS) | Complete | 3 view groups, 3 stylesheets, 3 scripts |
| Reporting & CSV export | Complete | FR-ADMIN-9 |
| Automated tests | Not started | 0% |
| Documentation | Complete (this report + spec) | — |

---

## 2. Work completed

Each item is traced to its requirement ID in `docs/spec.md`.

### 2.1 Foundation and data layer — setup.js, conn.js, config.js, middleware.js, utils.js

- [x] Environment-driven configuration with local defaults (`config.js`).
- [x] Pooled MySQL access with `connectionLimit: 10` and `dateStrings: true` (`conn.js`).
- [x] `wrap()` async error bridge, `requireRole()` gate, `flash()` helper (`middleware.js`).
- [x] scrypt password hashing with `timingSafeEqual` verification; date formatters; inline SVG icon
      registry exposed as `app.locals` (`utils.js`).
- [x] Idempotent seeder: drops/recreates the database, applies the schema for all 8 tables and loads
      demo data — 4 organizations, 40 users, 37 memberships, 7 applications, 5 events (1 draft),
      12 RSVPs, 4 notifications (`setup.js`, **spec §4.9**).

### 2.2 Authentication — routes/auth.js, views/shared/auth.ejs, index.ejs

- [x] FR-AUTH-1 landing page with session-aware redirect.
- [x] FR-AUTH-2 role-scoped login/register view, `?mode=register` switch, 400 on validation errors.
- [x] FR-AUTH-3 login with normalized email, scrypt verification, session `{id, name, role, org_id}`.
- [x] FR-AUTH-4 registration: email format, ≥6-char password, org name required for officers,
      duplicate `(email, role)` rejection, automatic organization creation for new officers.
- [x] FR-AUTH-5 logout (session destroy).
- [x] FR-AUTH-6 `requireRole('student' | 'admin')` guarding both portals with correct redirects.

### 2.3 Student portal — routes/student/index.js, views/student/*, public/js/student/student.js

- [x] FR-STUDENT-1 dashboard with organization cards (member count, saved flag, application status,
      membership flag), joined/pending/upcoming statistics, next 3 events, last 2 applications, category chips.
- [x] FR-STUDENT-2 discover page with free-text search over name, description, tags and category.
- [x] FR-STUDENT-3 apply endpoint (JSON) with full validation, re-application rule for rejected
      applications, and officer notification fan-out.
- [x] FR-STUDENT-4 bookmark toggle returning `{ saved }`.
- [x] FR-STUDENT-5 upcoming-events list with per-event `joined` flag and optional organization filter.
- [x] FR-STUDENT-6 RSVP toggle with publish-state guard and referer redirect.
- [x] FR-STUDENT-7 applications history + my-organizations view, pending-application tab badge.
- [x] Apply modal partial, organization card partial, portal chrome (top/bottom partials).

### 2.4 Officer portal — routes/admin/index.js, views/admin/*, public/js/admin/admin.js

- [x] FR-ADMIN-1 overview: time-of-day greeting, date, recent applications, featured event with
      attendees and RSVP count, statistics tiles.
- [x] FR-ADMIN-2 organization profile editing with validation and flash confirmation.
- [x] FR-ADMIN-3 member directory ordered by role precedence with name/email/role search.
- [x] FR-ADMIN-4 invite-by-email (student-only, duplicate-safe) with notification.
- [x] FR-ADMIN-5 role change (whitelist) and member removal, both scoped to the officer's organization.
- [x] FR-ADMIN-6 approve/decline workflow: pending-state guard, membership creation on approval,
      `reviewed_at` stamp, applicant notification.
- [x] FR-ADMIN-7 `orgStats()` — members, new-this-month, pending, upcoming events/RSVPs,
      attendance %, acceptance %, composite health score.
- [x] FR-ADMIN-8 event CRUD with `readEvent()` validation, draft/published lifecycle, member
      notification on publish (including draft → published transitions), scoped delete.
- [x] FR-ADMIN-9 reports page with zero-filled 6-month growth chart data and CSV export
      (`<org>-report.csv`, metrics + monthly series).
- [x] FR-ADMIN-10 settings: name update and password change requiring current-password verification.

### 2.5 Cross-cutting behaviour — app.js, public/js/shared/common.js

- [x] FR-NOTIFY-1 per-request injection of the 8 latest notifications and the unread count.
- [x] FR-NOTIFY-2 `POST /notifications/read` mark-all-read endpoint with 401 handling.
- [x] FR-NOTIFY-3 notification producers for applications, membership invites and event publishing.
- [x] One-shot flash messages rendered through the shared chrome.
- [x] 404 catch-all and logged 500 error handler; static asset serving; 8-hour session cookie.

### 2.6 Presentation layer

- [x] 24 EJS templates — student (5 pages + 4 partials), admin (7 pages + 2 partials),
      shared (6: landing, auth, head, foot, logo, tools).
- [x] `public/css/shared/base.css` design system plus student and admin theme bundles (~32 KB total).
- [x] `public/js/shared/common.js` (flash, notification drawer, mark-read, confirm dialogs),
      `student.js` (apply modal, bookmark, RSVP, filters), `admin.js` (event forms, member actions).
- [x] `public/pic/logo.png` and the inline SVG icon set in `utils.js`.

### 2.7 Documentation and repository

- [x] `README.md` with 3-step run instructions and folder guide.
- [x] `docs/spec.md` — full specification (architecture, data model, FRs, NFRs, risks).
- [x] This progress report.
- [x] `.gitignore` covering `node_modules/`.

---

## 3. Verification status

| Check | Status | Note |
| --- | --- | --- |
| Route/schema/view cross-references (route names match templates and links) | ✅ Verified by inspection | Consistent across `routes/*` and `views/*`. |
| SQL statements reference existing tables/columns | ✅ Verified by inspection | Matched against the schema in `setup.js`. |
| Validation and state transitions (application lifecycle, RSVP/bookmark toggles) | ✅ Verified by inspection | Guards implemented before writes. |
| Statistic formulas (`orgStats`, growth series) | ⚠️ Formula reviewed, **not executed** | Needs a runtime sanity check against seeded data. |
| Application boots (`npm start`) and serves all pages | ⏳ Not run | Requires MySQL + `npm run setup`. |
| End-to-end flows (login → apply → approve → notify) | ⏳ Not run | Manual test script pending (Section 5). |
| CSV export opens correctly in a spreadsheet | ⏳ Not run | Header/rows verified in code only. |
| Responsive layout in browsers | ⏳ Not checked | CSS reviewed, not rendered. |

---

## 4. Outstanding work

Prioritized backlog for the next iteration.

| # | Priority | Item | Spec ref | Notes |
| --- | --- | --- | --- | --- |
| 1 | High | Move DB credentials out of `config.js`; env-only defaults, rotate the exposed password | R1 | Committed password is a live credential. |
| 2 | High | Add CSRF protection to every POST route and AJAX call | R2 | Session token + header check. |
| 3 | High | Fill in the demo logins in `README.md` (the *Logins* section is empty) | — | 2-minute fix, blocks onboarding. |
| 4 | Medium | Persistent session store (`connect-mysql` or similar) | R3 | Survives restarts. |
| 5 | Medium | Manual end-to-end test pass (Section 3, unchecked rows) | — | Produce a short test script with expected results. |
| 6 | Medium | Pagination for members, applications and discover lists | §7 exclusion | Currently unbounded queries. |
| 7 | Medium | Student settings page (name + password) — officers have one, students do not | — | Asymmetry between portals. |
| 8 | Low | Unit tests for `orgStats`, `utils` (hash/verify, date formatters) and application transitions | R5 | Jest or node:test; no test harness exists yet. |
| 9 | Low | Password reset / email delivery | §7 exclusion | Requires an SMTP provider decision. |
| 10 | Low | Officer registration approval flow | R4 | Stops self-serve organization spam. |
| 11 | Low | Lint/format setup (ESLint + Prettier) and a CI workflow | — | One cosmetic spacing issue found in `routes/admin/index.js` line 38 (`Number(m.total )`). |

---

## 5. Next milestone (v1.1) — proposed scope

Ordered for a single short iteration:

1. **Security hardening** — items 1, 2 and 4 above; re-review `config.js`, session and forms.
2. **Docs and demo polish** — README logins (item 3), a `docs/testing.md` manual test script covering:
   - register (student and officer) → login → logout,
   - student: search → bookmark → apply → RSVP → re-apply after rejection,
   - officer: approve/decline → invite member → change role → publish event → CSV export,
   - negative cases: wrong password, duplicate email, empty intro, event with missing date.
3. **Runtime verification** — execute the script on a seeded database and record results in Section 3.
4. **Quality-of-life** — student settings page, pagination on the two largest lists.

**Exit criteria for v1.1:** every row in Section 3 shows ✅, the two High security items are closed,
and the README can be followed by a new developer without assistance.

---

## 6. Change log

| Version | Date | Commit | Description |
| --- | --- | --- | --- |
| 1.0.0 | (initial) | `0f71571` | Initial functional MVP: both portals, seeded database, full spec. |
| 1.0.0 docs | 19 Oct 2026 | _(this commit)_ | Added `docs/spec.md` and `docs/progress.md`. |
