# Implementation Prompt — O.M.N.I Full Rewrite: Next.js 15 + Supabase

> Copy-paste this file (or its §Prompt block) to a coding agent to build the complete
> Next.js rewrite of the O.M.N.I portal. The source app lives in `forloop/`
> (Express 4 + EJS 3 + MySQL); the target is a new sibling project, e.g. `forloop-next/`.

---

## Prompt

You are rebuilding **O.M.N.I**, a campus student-organization portal, from its production
Express + EJS + MySQL codebase (`forloop/`) into a **Next.js 15 (App Router, TypeScript) + Supabase** app
in a new folder `forloop-next/`.

**Read these first, in order:**

1. `docs/nextjs-architecture.html` — the authoritative blueprint: folder structure, full route/endpoint map (§4), Postgres schema + RLS (§5), access-control matrix (§6), design tokens (§7), feature specs for the tricky flows (§8), and the 10-phase build plan (§9).
2. `forloop/database.sql` and `forloop/setup.js` — the exact schema and seed data you must reproduce (13 tables; 4 orgs, 43 users, 37 memberships, 7 applications, 5 events — one full at 12/12 RSVPs, programs, announcements, notifications; dates relative to today so "upcoming" stays upcoming).
3. `forloop/routes/` and `forloop/views/` — the behavior you are porting. When in doubt, the Express code is the ground truth.
4. `docs/spec.md`, `docs/spec-events.md`, `docs/spec-nonmember.md` — baseline functional requirements (FR IDs) the finished app must satisfy.

### Ground rules

- **URLs are frozen.** Every path in blueprint §4.1 must resolve in the new app, unchanged (`/student/discover`, `/admin/events/:id/attendance`, `/nonmember/events?org=`, …).
- **Portal semantics are frozen.** The student/non-member split comes from **membership count**, never a role value. Approving a non-member's application auto-graduates them to `/student`; removing someone from their last org demotes them to `/nonmember`. Advisers belong to exactly one org (`profiles.org_id`).
- **Authority is per-request.** Never trust the session cookie for role/org/membership — re-fetch the profile row in guards (blueprint §6.2). This mirrors the original's `loadUser` middleware.
- **No ORM.** Typed parameterized SQL in `lib/queries/`, mirroring the original queries (including the correlated subqueries and the single `UPCOMING` predicate, now the `upcoming_events` view).
- **No Tailwind / no UI kit.** Port the existing CSS-variable design system verbatim (blueprint §7 — tokens, 13 org brand colors, dark mode via `data-theme`). Fonts via `next/font/google` (Bricolage Grotesque + DM Sans).
- **Keep the original helper logic** by porting it, not re-inventing: scrypt login → Supabase Auth; `parseProgram`/`programToText`; ICS builder (75-char folding); CSV export; `fmt*`/`initials`/`deptAbbr`; the SVG icon registry as React components.
- TypeScript strict. Server Components by default; client components only where interactivity demands it (modals, chips, drawer, bell, attendance select-all, RSVP button).
- Work **phase by phase** (blueprint §9). Run the dev server and verify each phase's acceptance criteria before moving on. Do not skip ahead and leave broken pages.

### Stack pinned

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15, App Router, TypeScript strict |
| DB + Auth + Storage + Cron | Supabase (Postgres, `@supabase/ssr` cookie auth, Storage buckets `avatars`/`org-logos`, pg_cron for the hourly reminder fn) |
| Styling | Plain CSS + CSS variables (globals.css + per-portal css), no framework |
| Mutations | Server Actions; downloads/feeds as Route Handlers (`/api/calendar`, `/api/calendar/[id]`, `/api/reports/export`, `/api/notifications/read`) |
| Validation | Zod (or hand-rolled ports of `validators.ts` helpers) — pick one, be consistent |
| Env | `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

### Milestones (blueprint §9 has acceptance criteria per phase)

1. **Scaffold + schema** — `create-next-app`; Supabase migrations for all 13 tables + `upcoming_events` view + RLS policies; `scripts/seed.ts` reproducing the demo dataset via the Supabase admin API (auth users can't be seeded by raw SQL); pg_cron reminder function scheduled.
2. **Auth + shell** — register/login/logout actions, `middleware.ts` portal gates (§6.1 matrix), three `PortalShell` layouts, `/student-info` onboarding, cookie flash + toast, theme toggle with no-FOUC script.
3. **Design system** — tokens, brand colors, Button/Card/Modal/Badge/Field, icons, fmt utils. Light + dark reviewed side-by-side against the old app.
4. **Student portal** — home, discover (search + category chips), bookmarks, applications history, my-organizations, directory, announcements.
5. **Shared features** — apply modal + action (≤ 5 per-org questions, denormalized answers), recruitment page, events page + month calendar grid, RSVP/waitlist state machine (§8.1, transactional), ICS downloads.
6. **Non-member portal** — reduced shell + 4 pages reusing phase 4/5 components; lifecycle transitions verified.
7. **Admin portal** — overview KPIs, organization editor (+color picker/logo), members (invite/role/remove), officers (reorder/add/remove), applications pipeline + question editor, events CRUD (+program textarea, publish-once notify), attendance check-in, announcements (update/recruitment), reports + CSV export.
8. **Notifications + reminders** — bell (last 8 + unread), mark-read, all six fan-out points (§8.4), pg_cron job firing once per event.
9. **Uploads + settings** — avatar/org-logo via Storage (2 MB + mime checks, old-object cleanup), settings page (profile, password, appearance).
10. **Polish + tests** — responsive pass, empty states, auth rate limiting, optional email verification, unit tests (ics/csv/program/waitlist promotion), Playwright smoke of the gate matrix.

### Definition of done

- Every URL in blueprint §4 resolves against the seeded database and matches the original app's behavior.
- Gate matrix (blueprint §6.1) passes for every persona combination, verified by the Playwright smoke test.
- End-to-end verified: apply → approve → membership + notification + graduation to `/student`; full event → waitlist → cancel → promotion; event publish → member notifications → reminder job; capacity raise → waitlist promotion.
- Light and dark themes visually match the Express app.
- `README.md` documents: Supabase project setup, env vars, `supabase db push`, `npm run seed`, `npm run dev`, pg_cron enablement.
- Final summary lists every file created and maps features to FR IDs from `docs/spec*.md`.

---

## Source ↔ target traceability

| Source area | Ported to | Blueprint ref |
| --- | --- | --- |
| `app.js` (middleware chain, locals) | root `layout.tsx`, `middleware.ts`, `lib/guards.ts` | §3, §6 |
| `conn.js` + `mysql2` callbacks | `lib/supabase/{server,admin}.ts` + `lib/queries/*` | §2, §5 |
| `routes/auth.js` | `app/login`, `app/register`, `actions/auth.ts` | §4.2, §6.3 |
| `routes/profile.js` | `app/(account)/*`, `actions/profile.ts` | §4.1 |
| `routes/uploads.js` | `actions/uploads.ts` + Storage | §8.7 |
| `routes/student/index.js` | `app/(student)/student/*` | §4.1 |
| `routes/nonmember/index.js` | `app/(nonmember)/nonmember/*` | §4.1, §6.1 |
| `routes/admin/index.js` | `app/(admin)/admin/*`, `actions/admin.ts` | §4.1, §4.2 |
| `routes/portal.js` (shared pages) | shared domain components (`EventsPage`, `RecruitmentList`, `OrgCard`, `ApplyModal`) | §3, §7.4 |
| `routes/apply.js` | `actions/apply.ts` | §8.2 |
| `routes/rsvp.js` (`promoteWaitlist`) | `actions/rsvp.ts` + `lib/queries/rsvps.ts` | §8.1 |
| `routes/program.js` | `lib/program.ts` (verbatim port) | §8.3 |
| `routes/calendar.js` | `lib/generators/ics.ts` + `/api/calendar` | §4.3, §8.6 |
| `routes/reminders.js` | pg_cron SQL function | §8.5 |
| `utils.js` (viewHelpers, fmt, crypto) | `components/icons/*`, `lib/utils.ts`, Supabase Auth | §7.4 |
| `public/css/*` | `app/globals.css` + per-portal css | §7 |
| `public/js/*` | client components (no IIFE ports) | §7.4 |
| `setup.js` (seed) | `scripts/seed.ts` + `supabase/migrations` | §5.2 |
