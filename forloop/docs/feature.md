# O.M.N.I — Feature List

Part 1 lists the features currently in the system (business side).
Part 2 lists candidate features not yet built.

## Public / Shared

- Landing page, sign-in and sign-up
- Student information form after registration
- Profile and settings pages, password change
- Profile avatar upload
- Notification bell with unread count
- Dark / light theme toggle

## Student Portal

- Home dashboard with stats, suggested organizations, upcoming events
- Discover organizations (search + category filters)
- Bookmark / save organizations
- Apply to an organization (intro + custom questions)
- Applications status tracker with pending badge
- My Organizations list
- Member directory per organization
- Announcements feed
- Recruitment board (open calls, deadlines)
- Events list with calendar view and organization filter
- RSVP to events, waitlist position when full
- Download events as calendar file (.ics)

## Non-Member Portal

- Limited home, discover, apply, events, recruitment (until first application is approved)

## Adviser / Admin Portal

- Overview dashboard (members, applications, events, RSVP counts)
- Edit organization profile (name, description, category, tags, logo, schedule)
- Member list with search, invite by email, change role, remove
- Officer role hierarchy: add, rename, reorder, delete
- Review applications: approve / decline
- Set custom screening questions for applicants
- Create / edit / delete events, draft vs published, seat capacity, event program
- Attendance check-in for events
- Post and delete announcements (update or recruitment)
- Reports with charts (acceptance, attendance, growth) and CSV export

---

# Part 2 — Candidate Features (not yet implemented)

## Accounts & security

- Password reset via email link
- Two-factor / OTP login for advisers
- Officer/adviser registration approval (prevents fake organizations)
- Session "sign out everywhere" and active session list
- CSRF protection on all forms and AJAX calls

## Organizations

- Multiple advisers / co-officers per organization
- Organization verification badge; archive or dissolve an organization
- Social links and photo gallery on the organization profile
- Department-based eligibility auto-matching
- Organization ratings and reviews from members

## Recruitment & applications

- Recruitment periods (open/close dates) with automatic expiry
- Application status timeline (submitted → under review → decided)
- Bulk approve / decline, plus reviewer notes per application
- Saved replies / rejection templates
- Applicant shortlisting and intake-slot waitlist
- Résumé or file attachment upload with applications

## Events

- Recurring / repeat events (weekly, monthly)
- QR code or student ID check-in at the door
- Post-event feedback / rating survey
- Waitlist alerts when a seat becomes available
- Event cover image and downloadable handouts
- Attendee list CSV export; Google/Outlook calendar sync
- Past-events archive and "events I attended" history

## Communication

- Announcement scheduling and pinning
- Direct messages / chat between members and officers
- Broadcast email to selected members or roles
- Comment threads on announcements and events
- Per-user notification preferences (channel and on/off)

## Engagement & gamification

- Points, badges and leaderboards for attendance and volunteering
- Volunteer hour tracking and certificates
- Streaks and "member of the month"
- Polls and surveys for members

## Reporting & admin

- Attendance analytics (per event, per member, no-show rate)
- CSV export for members and applications
- Audit log of officer actions (who changed what, when)
- Platform super-admin dashboard (all organizations, moderation)
- Automated monthly report emailed to advisers

## Platform / UX

- Pagination and infinite scroll on long lists
- Global search with keyboard shortcuts / command palette
- Mobile PWA with push notifications
- Profile completion meter
- Accessibility pass (ARIA, contrast, keyboard navigation)
- Multi-language (EN / Filipino) support
- Unit and end-to-end test suite with CI
- Environment-driven configuration (move DB credentials out of code)
