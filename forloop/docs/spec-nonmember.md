# Feature Specification — Non-Member Portal (`/nonmember`)

**Project:** 4loopGroup (fourloopgroup) v1.0.0 → v1.1 increment
**Companion documents:** [`docs/spec.md`](./spec.md) (baseline), [`docs/spec-events.md`](./spec-events.md) (paired feature)
**Status:** Approved for implementation
**Baseline:** derived from the implemented codebase (commit `0f71571`) and the baseline spec sections **FR-AUTH-1/3/6**, **FR-STUDENT-2/3/5/6**, **§4.3 memberships**.

---

## 1. Purpose and scope

Requested feature: *"create a folder and routes for the non org members with only limited access — can join org, can view event."*

Today every logged-in student is routed to `/student` regardless of membership, so a student who belongs to **no** organization sees the full member portal (My organizations, Applications history, etc.) with nothing meaningful in it.

This spec introduces a **third portal area** for exactly that audience:

- **Audience:** users with `role = 'student'` **and zero rows** in `memberships` for their `user_id`.
- **Enforcement:** redirect/lock — these students are routed to `/nonmember` after login and are bounced back there from `/student/*`. Approval into an organization graduates them to `/student` automatically; removal from their last organization demotes them back.
- **Capabilities:** browse/search organizations, view organization profiles (card + "View & apply" modal — the same view a member sees of an organization they do not belong to), apply to join, view upcoming published events, and join (RSVP to) an event.

### 1.1 No schema change, no new role

The gate is a **membership count**, not a new `users.role` value:

- `users.role` stays `ENUM('student','admin')` (baseline §4.2) — no migration.
- "Non-member" is derived per request: `SELECT COUNT(*) FROM memberships WHERE user_id = ?`.
- The session shape `{ id, name, role, org_id }` (FR-AUTH-3) is unchanged.

---

## 2. Access matrix

| Capability | `/nonmember` (0 orgs) | `/student` (≥1 org) | `/admin` (officer) |
| --- | :---: | :---: | :---: |
| Browse / search organizations (Discover) | ✅ `FR-NONMEMBER-2` | ✅ | — |
| View org profile (card + View & apply modal) | ✅ `FR-NONMEMBER-2` | ✅ | — |
| Apply to join an organization | ✅ `FR-NONMEMBER-3` | ✅ | — |
| View upcoming published events | ✅ `FR-NONMEMBER-4` | ✅ | ✅ |
| Join (RSVP) an event | ✅ `FR-NONMEMBER-5` | ✅ | — |
| Notifications drawer | ✅ (global middleware) | ✅ | ✅ |
| My organizations page | ❌ locked | ✅ | — |
| Applications history page | ❌ locked (status surfaced via modal + notification) | ✅ | — |
| Bookmarks (save an org) | ❌ not offered | ✅ | — |
| Organization profile editing / members / reports | ❌ | ❌ | ✅ |
| Create / manage events | ❌ | ❌ | ✅ |

**Org profile viewing rule (per product decision):** a non-member viewing an organization sees *exactly* what a member sees when viewing an organization they are **not** a member of — the `orgcard` partial plus the `apply_modal` detail popup (name, description, tags, category, meeting schedule, member count). There is **no** dedicated `/nonmember/org/:id` profile page; no such page exists for members either.

---

## 3. Folder and routing structure (new)

```
forloop/
├── routes/
│   ├── nonmember/            ← NEW FOLDER
│   │   └── index.js          ← NEW: limited portal router
│   ├── auth.js               ← MODIFY: membership-aware home redirect
│   ├── student/              ← MODIFY: add non-member lock
│   └── admin/                ← unchanged
├── views/
│   ├── nonmember/            ← NEW FOLDER
│   │   ├── home.ejs          ← limited landing (orgs + upcoming events)
│   │   ├── discover.ejs      ← browse/search + org cards + apply modal
│   │   ├── events.ejs        ← upcoming events + join (RSVP)
│   │   └── partials/
│   │       ├── top.ejs       ← reduced nav: Home · Discover · Events
│   │       └── bottom.ejs
│   └── student/ …            ← unchanged (shared partials reused, see §6)
├── middleware.js              ← MODIFY: add membership gate helpers
├── app.js                     ← MODIFY: mount router at /nonmember
└── public/js/student/student.js ← MODIFY: parameterize endpoint URLs (§6)
```

**Mount order** in `app.js` (alongside the existing mounts):

```js
app.use('/nonmember', require('./routes/nonmember'));
```

**Nav (`views/nonmember/partials/top.ejs`):** mirrors `views/student/partials/top.ejs` but with three links only — Home (`/nonmember`), Discover (`/nonmember/discover`), Events (`/nonmember/events`) — and **no** Applications badge. Search box posts to `/nonmember/discover`. Notification drawer and avatar menu reuse `views/shared/tools.ejs` unchanged.

---

## 4. Access control (redirect/lock model)

### 4.1 Gate helpers — `middleware.js`

| Helper | Behavior |
| --- | --- |
| `hasOrg(uid)` | `COUNT(*)` over `memberships WHERE user_id = ?`. Cheap, indexed by `user_id`; call once per request. |
| `requireNonMember` | Attached inside the `/nonmember` router after `requireRole('student')`: no session → `/login/student` (existing behavior); `hasOrg(uid) > 0` → **redirect to `/student`** (graduated member). |
| `lockNonMembers` | Attached inside `/student` router after `requireRole('student')`: `hasOrg(uid) === 0` → **redirect to `/nonmember`**. |

Implementation note: `hasOrg` may be inlined as a `wrap()` middleware in each router instead of exported — the requirement is the *behavior*, not the exact symbol.

### 4.2 Login / register landing — `routes/auth.js`

`home(u)` currently returns `/student` for every student. It becomes membership-aware:

| Condition after auth | Redirect |
| --- | --- |
| `role === 'admin'` | `/admin` (unchanged) |
| `role === 'student'`, `COUNT(memberships) = 0` | **`/nonmember`** |
| `role === 'student'`, `COUNT(memberships) ≥ 1` | `/student` (unchanged) |

Same rule applies to `GET /` when an existing session is present (FR-AUTH-1) and after `POST /auth/register` for a brand-new student (who by definition has 0 memberships → `/nonmember`).

### 4.3 Lifecycle transitions

| Event | Effect |
| --- | --- |
| Application **approved** (FR-ADMIN-6) → membership row created | Next request: `requireNonMember` sees `hasOrg > 0` and redirects to `/student`. Graduation is automatic; **no code change in the admin router**. The existing approval notification ("Welcome aboard!") already explains the move. |
| Member **removed** from their last organization (FR-ADMIN-5) | Next request: `lockNonMembers` sees `hasOrg = 0` on `/student` and redirects to `/nonmember`. |
| Application pending / rejected | Stays in `/nonmember` (no membership yet). Status is visible through the apply-modal state (`data-status`) and notifications. |
| Officer (`admin`) | Never reaches `/nonmember` — `requireRole('student')` bounces non-students to their own portal. |

### 4.4 Negative cases

| Case | Expected |
| --- | --- |
| No session → any `/nonmember/*` route | Redirect `/login/student`. |
| Member (≥1 org) → `/nonmember/*` | Redirect `/student`. |
| Non-member → `/student/*` | Redirect `/nonmember`. |
| Admin → `/nonmember/*` | Redirect `/admin` (via `requireRole`). |
| Non-member RSVPs a draft event | No `rsvps` row (guard kept from FR-STUDENT-6). |
| Non-member applies to a nonexistent org | `404 { error }`; already a member / already pending → `400 { error }` (same as FR-STUDENT-3). |

---

## 5. Functional requirements

Format: `FR-NONMEMBER-<n>` — same conventions as baseline §5.

| ID | Requirement |
| --- | --- |
| FR-NONMEMBER-1 | `GET /nonmember` — limited home. Renders: (a) org cards for **all** organizations with member count, application status and membership flag (the `getOrgs` shape — though `is_member` is always false here), (b) counts for *organizations to explore* and *upcoming events*, (c) the next **3** upcoming published events (same `UPCOMING` predicate as [`spec-events.md` §2.1](./spec-events.md)) linking to `/nonmember/events`, (d) category chips for filtering. Empty states when there are no organizations or no events. |
| FR-NONMEMBER-2 | `GET /nonmember/discover?q=` — free-text search over `name`, `description`, `tags`, `category` with category chips (mirror of FR-STUDENT-2). Renders the shared `orgcard` partial; clicking *View & apply* opens the shared `apply_modal` (the org-profile view, §2 rule). The bookmark control is **not rendered / not functional** in this portal. |
| FR-NONMEMBER-3 | `POST /nonmember/apply` — JSON API. **Identical validation and semantics to FR-STUDENT-3:** `org_id` numeric, `intro` non-empty, `agree` present, organization must exist (404), not already a member (400), no non-rejected application already open (400); a prior `rejected` application is reset to `pending` with fresh `created_at` and `reviewed_at = NULL`, otherwise insert. Notifies all officers of that organization. Returns `{ ok: true, name }`. *(Extract the shared body of FR-STUDENT-3 into one helper used by both routers, or replicate exactly — divergence is a defect.)* |
| FR-NONMEMBER-4 | `GET /nonmember/events?org=` — list upcoming published events with the organization name and a `joined` flag; optional `?org=` filter with `filterOrg` heading resolution (mirror of FR-STUDENT-5). **No drafts, no past events** (shared `UPCOMING` predicate). |
| FR-NONMEMBER-5 | `POST /nonmember/events/:id/rsvp` — toggle RSVP with the publish-state guard, then redirect to `Referer` (or `/nonmember/events`). Mirror of FR-STUDENT-6. |
| FR-NONMEMBER-6 | Gate enforcement per §4: `requireNonMember` on `/nonmember`, `lockNonMembers` on `/student`, membership-aware `home()` in `routes/auth.js`. |
| FR-NONMEMBER-7 | Notifications: the global `app.js` middleware already loads `notes`/`unread` for any session — unchanged, so application decisions reach non-members in the drawer. Apply submissions notify officers (via FR-NONMEMBER-3). No new notification producer required. |

### 5.1 Explicitly excluded from `/nonmember`

- `/student/organizations`, `/student/applications` (member/history views) — locked by FR-NONMEMBER-6.
- Bookmarks — no save control rendered, no `POST /nonmember/bookmark` route.
- Any `/admin` capability.
- Officer invites (FR-ADMIN-4) remain the fast path: an invited student gains a membership and is graduated on next request.

---

## 6. Shared assets and reuse

| Asset | Reuse decision |
| --- | --- |
| `views/student/partials/orgcard.ejs` | **Reuse as-is** for the card. Its `data-save` (bookmark) button is simply never triggered — see JS note below. If server-side cleanliness is preferred, guard the button with a `locals.hideSave` flag. |
| `views/student/partials/apply_modal.ejs` | **Reuse as-is** (org profile + application form). |
| `public/js/student/student.js` | **Loaded unchanged** via `shared/foot.ejs` (role `student`), but it hardcodes `/student/apply` (line 64) and `/student/bookmark/:id` (line 17). **Required change:** read the submit target from the form, e.g. `<form id="applyForm" action="/student/apply" data-endpoint="/nonmember/apply">` → `fetch(form.dataset.endpoint || '/student/apply', …)`, with `views/nonmember/*` setting the endpoint to `/nonmember/apply`. Same pattern for any fetch URL reused in this portal. |
| `public/css/student/student.css` | Loaded automatically for `role = 'student'`; non-member pages reuse the student theme. New markup should use existing classes (`.ev-grid`, `.org-grid`, `.chips`, `.empty-card`); a `views/nonmember` stylesheet is out of scope unless a layout gap appears. |
| `utils.js` helpers (`icon`, `fmt*`, `initials`) | Available via `app.locals` — no change. |
| `conn.js`, session, flash | Unchanged; `flash()` used for any form-level feedback. |

**Why parameterize instead of duplicating JS:** one script serves both portals, so the endpoint must be view-supplied. Acceptance AC-7 guards this.

---

## 7. Data model impact

**None.** Uses existing tables only:

- `memberships` — read as the gate (`COUNT`) and as the graduation source.
- `organizations`, `bookmarks` (read-only for `saved` flag is *not* needed here), `applications`, `events`, `rsvps`, `notifications` — all baseline §4.

No migration, no seeder change, no new `users.role` value.

---

## 8. Files touched (summary)

| File | Change | Expected effort |
| --- | --- | --- |
| `routes/nonmember/index.js` | **NEW** — router + 5 routes (§5). | Medium |
| `views/nonmember/{home,discover,events}.ejs`, `partials/{top,bottom}.ejs` | **NEW** — reduced-nav portal pages. | Medium |
| `middleware.js` | Add `hasOrg` / `requireNonMember` / `lockNonMembers` (behavior per §4.1). | Small |
| `routes/auth.js` | Membership-aware `home()` for login, register, and `GET /`. | Small |
| `routes/student/index.js` | Attach `lockNonMembers` after `requireRole('student')`. | Tiny |
| `app.js` | `app.use('/nonmember', …)` mount. | Tiny |
| `public/js/student/student.js` | Parameterize fetch endpoints via `data-endpoint` (§6). | Small |
| `views/student/*`, `routes/admin/*` | **Unchanged.** | — |

---

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Security — access | Both gates run before any route body; every write stays parameterized and org-scoped; non-members cannot reach `/admin` or member-only queries. |
| Security — session | Unchanged 8-hour cookie; no new role claims in the session (the count query is authoritative, so graduation/demotion can't go stale in the session). |
| Performance | One extra indexed `COUNT` per request inside the portal routers; lists bounded by `UPCOMING` + `LIMIT` where applicable (same as baseline). |
| Consistency | Same validation messages and JSON error bodies as FR-STUDENT-3 so shared client code behaves identically. |
| Accessibility | Same semantic forms/labels/`aria-hidden` rules as the baseline (§6). |

---

## 10. Acceptance criteria

| # | Criterion |
| --- | --- |
| AC-1 | New student registers → lands on `/nonmember`, never on `/student`. |
| AC-2 | Non-member clicking any `/student/*` link (or typing the URL) is bounced back to `/nonmember`. |
| AC-3 | From `/nonmember` a student can search, open the org profile popup, submit a valid application, and receives the success state; officers are notified. |
| AC-4 | Approval by an officer → the student's next navigation lands on `/student` with full member portal; no manual step. |
| AC-5 | Removal from the last organization → the student's next `/student` request bounces to `/nonmember`. |
| AC-6 | `/nonmember/events` lists only published, not-yet-past events; RSVP toggles and survives reload; drafts are never listed. |
| AC-7 | Applying from `/nonmember` posts to `/nonmember/apply` (verified in the network tab) — no request hits `/student/apply`. |
| AC-8 | Bookmarks are not offered: no `data-save` control works and no bookmark row is created for non-members. |
| AC-9 | Admin visiting `/nonmember` is redirected to `/admin`; unauthenticated users to `/login/student`. |
| AC-10 | Member visiting `/nonmember` is redirected to `/student`. |

---

## 11. Out of scope

- Application-history page for non-members (status arrives via modal state + notifications).
- Bookmarks from the non-member portal.
- A public (logged-out) events calendar — this portal requires a student session.
- Automatic "browse as guest" without registration.
- Dedicated per-organization profile page (does not exist for members either).
