# Feature Specification — Event Creation & Dashboard Display

**Project:** 4loopGroup (fourloopgroup) v1.0.0 → v1.1 increment
**Companion documents:** [`docs/spec.md`](./spec.md) (baseline), [`docs/spec-nonmember.md`](./spec-nonmember.md) (paired feature)
**Status:** Approved for implementation
**Baseline:** derived from the implemented codebase (commit `0f71571`) and the baseline spec sections **FR-ADMIN-1**, **FR-ADMIN-8**, **FR-STUDENT-1**, **§4.5 events**.

---

## 1. Purpose and scope

Requested feature: *"add events in the event pages and display them in the dashboard."*

- **Add events on the event pages** — officer (admin) capability, formalized from the already-implemented `/admin/events` CRUD.
- **Display events on the dashboards** — formalize the student home list; add a **new** multi-event list to the officer overview dashboard (today it shows only a single featured event).

### 1.1 What is formalized vs. what is new

| Item | State today | In this spec |
| --- | --- | --- |
| Create / edit / delete events at `/admin/events` | Implemented (FR-ADMIN-8) | Formalized as **FR-EVENTS-1…4** — no code change expected |
| `?new=1` deep link opens the create modal | Implemented (`admin.js`) | Formalized as **FR-EVENTS-5** |
| Student home "Coming up" (next 3 events) + upcoming count | Implemented (FR-STUDENT-1) | Formalized as **FR-EVENTS-6** |
| Officer overview multi-event list | **Missing** — only one featured event | **New code: FR-EVENTS-7** |

### 1.2 Baseline cross-references

| Baseline ID | Relationship |
| --- | --- |
| FR-ADMIN-8 | Event CRUD lifecycle — unchanged; re-stated here as FR-EVENTS-1…4 for a single readable feature spec. |
| FR-ADMIN-1 | Officer overview — extended by FR-EVENTS-7. |
| FR-ADMIN-7 `orgStats` | The "Upcoming events" KPI tile is fed by the same predicate as FR-EVENTS-7; the new list is its drill-down. |
| FR-STUDENT-1 | Student dashboard — formalized as FR-EVENTS-6. |
| FR-STUDENT-5 / FR-STUDENT-6 | Event list and RSVP on the student portal — unchanged, referenced by visibility rules. |
| FR-NOTIFY-3 | Producer "event published (all members)" — formalized as FR-EVENTS-3. |

---

## 2. Functional requirements

Format: `FR-EVENTS-<n>` — same conventions as baseline §5.

| ID | Requirement |
| --- | --- |
| FR-EVENTS-1 | `GET /admin/events` — list this organization's events (all statuses) ordered by `event_date`, `event_time`, each with its RSVP count. Draft rows show `–` in place of the count and a *Draft* eyebrow; published rows show the count. |
| FR-EVENTS-2 | `POST /admin/events` — create an event via `readEvent(body)` validation: `title` required (trimmed), `event_date` must match `YYYY-MM-DD`, `event_time` must match `HH:MM`, `location` defaults to `TBA`, `description` optional, `status` is `published` only when `body.status === 'published'`, otherwise `draft`. Validation failure → error flash *"Add a title, date and time to create the event."* and redirect back to `/admin/events` (no row written). The row is always scoped to `org_id` = the officer's organization from the session. |
| FR-EVENTS-3 | **Publish notification:** insert a `notifications` row for every `memberships` row of the organization (`New event from <org name>: <title>`) when (a) an event is created with `status = 'published'`, or (b) an existing event transitions `draft → published` on update. Saving as draft, or editing an already-published event, does **not** notify. Flash differs: *"Event published. Members were notified."* vs *"Draft saved."* |
| FR-EVENTS-4 | `POST /admin/events/:id` — update; `POST /admin/events/:id/delete` — delete. Both queries are scoped `WHERE id = ? AND org_id = ?`; an unknown/foreign id performs **no write** and redirects silently (no data leak). Delete cascades RSVPs via the existing FK (`rsvps.event_id` ON DELETE CASCADE). |
| FR-EVENTS-5 | **Deep link:** `GET /admin/events?new=1` (linked from the overview "Create event" button) causes the client to open the create modal in its reset state (`admin.js` reads `?new`). Server ignores the parameter. |
| FR-EVENTS-6 | **Student dashboard display (formalized):** `GET /student` renders (a) the `stats.upcoming` count = published events with `event_date >= CURDATE()` across **all** organizations, and (b) the next **3** of those ordered by `event_date`, `event_time`, each row linking to `/student/events`. No draft and no past event may ever appear. |
| FR-EVENTS-7 | **Officer dashboard list (NEW):** `GET /admin` renders an *Upcoming events* section **below the existing featured-event block**, listing up to the next **5** events where `org_id = <officer's org>` AND `status = 'published'` AND `event_date >= CURDATE()`, ordered by `event_date`, `event_time`. Each row shows: date tile (`fmtMon`/`fmtDay`), title, `fmtTime(event_time)` · location, RSVP count (integer, `0` allowed), and a *Manage* link to `/admin/events`. **Empty state:** when no event matches, render *Nothing scheduled yet* with a *Create event* link to `/admin/events?new=1`. Drafts and other organizations' events never appear. |

### 2.1 Visibility rules (shared predicate)

All dashboard/event-list surfaces use the baseline `UPCOMING` predicate from `routes/student/index.js`:

```sql
e.status = 'published' AND e.event_date >= CURDATE()
```

| Surface | Scope | Predicate | Limit |
| --- | --- | --- | --- |
| Student home count (FR-EVENTS-6a) | all orgs | `UPCOMING` | none (count) |
| Student home list (FR-EVENTS-6b) | all orgs | `UPCOMING` | 3 |
| Officer overview KPI (existing) | own org | `UPCOMING` | none (count) |
| Officer overview featured (existing) | own org | `UPCOMING` | 1 |
| **Officer overview list (FR-EVENTS-7)** | own org | `UPCOMING` | **5** |
| Student events page (FR-STUDENT-5) | all/filtered orgs | `UPCOMING` | none |
| `/admin/events` management list | own org | none (all events) | none |

**Drafts** are visible only on `/admin/events`. **Past events** (`event_date < CURDATE()`) are visible only on `/admin/events`.

### 2.2 Recommended query shape for FR-EVENTS-7

The overview currently runs one query for `featured`. Implementation should fetch the list once (LIMIT 5, with a correlated `COUNT` subquery for RSVPs, mirroring the `/admin/events` list query) and may derive `featured` from the first row, then keep the existing attendee lookups (`LIMIT 3` avatars + total count) for that row. A single list query + the existing attendee queries is the target; two separate `UPCOMING` queries (list + featured) is acceptable if left unchanged for clarity.

---

## 3. Data model impact

**None.** The `events` table (baseline §4.5) already carries every required column
(`org_id`, `title`, `event_date`, `event_time`, `location`, `description`, `status ENUM('draft','published')`),
and `rsvps` already provides the counts. No migration, no seeder change.

---

## 4. Files touched

| File | Change | Expected effort |
| --- | --- | --- |
| `routes/admin/index.js` | Extend the `GET /admin` handler with the FR-EVENTS-7 list query (and optionally merge `featured`). | Small |
| `views/admin/overview.ejs` | New `<section>` for the list + empty state, placed after the existing `.feature` block. Reuse `.ev-admin` row markup / `.date-tile` styles from `views/admin/events.ejs`. | Small |
| `public/css/admin/admin.css` | Only if the events-page row styles need spacing adjustments on the overview canvas. | None–minimal |
| `routes/admin/index.js` (CRUD), `views/admin/events.ejs`, `public/js/admin/admin.js` | **Unchanged** — formalized as-is (FR-EVENTS-1…5). | — |
| `routes/student/index.js`, `views/student/home.ejs` | **Unchanged** — formalized as-is (FR-EVENTS-6). | — |

---

## 5. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Access | FR-EVENTS-1…5 remain behind `requireRole('admin')`; every write scoped by session `org_id` (baseline §6). |
| Queries | Parameterized only; overview stays bounded (`LIMIT 5` + correlated counts — no N+1 loops), consistent with the baseline performance rule. |
| Feedback | Flash messages for create/update/delete/publish; empty state instead of a blank section. |
| Accessibility | Row links carry visible text labels (*Manage*/*Create event*), date tiles are not colour-only (month/day text), decorative icons stay `aria-hidden`. |
| Consistency | Date/time rendered through the shared `fmt*` helpers (`app.locals`), never raw strings. |

---

## 6. Acceptance criteria

| # | Criterion |
| --- | --- |
| AC-1 | Officer creates a **published** event from `/admin/events` → it appears in the new overview list (if among the next 5), in `/student/events`, and every member receives one notification. |
| AC-2 | Officer creates a **draft** → visible only on `/admin/events`; never on either dashboard; no notification sent. |
| AC-3 | Editing a draft and switching it to *published* notifies members exactly once (the publish transition), not on later edits. |
| AC-4 | An event dated yesterday does not appear on either dashboard but still appears on `/admin/events`. |
| AC-5 | The overview list shows at most 5 rows ordered by date then time, with correct RSVP counts, and a *Manage* link per row. |
| AC-6 | With zero upcoming published events, the overview shows the *Nothing scheduled yet* empty state with a working `?new=1` link. |
| AC-7 | An officer cannot update or delete another organization's event (scoped query → no write, redirect). |
| AC-8 | Student home still shows exactly the next 3 upcoming events and the correct upcoming count. |
| AC-9 | A student with 0 memberships sees the dashboard surfaces only through `/nonmember` (governed by [`spec-nonmember.md`](./spec-nonmember.md)); the FR-EVENTS-6 query is unchanged for members. |

---

## 7. Out of scope

- Event RSVP management/attendance check-in UI for officers.
- Editing or deleting events from the overview dashboard (the list is read + deep link only).
- Recurring events, event images/banners, categories, or capacity limits.
- Pagination of the `/admin/events` management list.
- Showing past events to students.
