/*
 * Pages shared by the student portal and the non-member portal:
 * Discover, Apply, Events and RSVP. Each portal calls addSharedPages()
 * with its own view folder ("student" / "nonmember") and URL prefix.
 */
const db = require('../conn');
const { text, parallel, flash, ymd, MON } = require('../utils');
const { applyToOrg } = require('./apply');
const { attachProgram } = require('./program');
const { promoteWaitlist } = require('./rsvp');
const { buildCalendar } = require('./calendar');

/* SQL condition: events students are allowed to see. */
const UPCOMING = "e.status = 'published' AND e.event_date >= CURDATE()";

/*
 * Organizations with member count and this user's saved / application / member state.
 * Pass '' as `search` to get every organization. done(err, orgs)
 */
function getOrgs(uid, search, done) {
  const params = [uid, uid, uid];
  let where = '';

  if (search) {
    const like = `%${search}%`;
    where =
      'WHERE o.name LIKE ? OR o.description LIKE ? OR o.tags LIKE ? OR o.category LIKE ? OR o.eligibility LIKE ?';
    params.push(like, like, like, like, like);
  }

  db.query(
    `
    SELECT o.*,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.org_id = o.id AND b.user_id = ?) AS saved,
      (SELECT a.status FROM applications a WHERE a.org_id = o.id AND a.user_id = ?) AS app_status,
      EXISTS(SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = ?) AS is_member
    FROM organizations o ${where} ORDER BY o.id`,
    params,
    (err, orgs) => {
      if (err || !orgs.length) {
        return done(err, orgs);
      }
      /* Each organization's application questions travel with it, for the apply popup */
      db.query(
        'SELECT org_id, question FROM org_questions WHERE org_id IN (?) ORDER BY position, id',
        [orgs.map((o) => o.id)],
        (err, questions) => {
          if (err) {
            return done(err);
          }
          orgs.forEach((o) => {
            o.questions = questions.filter((q) => q.org_id === o.id).map((q) => q.question);
          });
          done(null, orgs);
        },
      );
    },
  );
}

/* The next `limit` upcoming events across all organizations, plus how many exist. done(err, { total, events }) */
function getUpcomingSummary(limit, done) {
  parallel(
    {
      count: (cb) => db.query(`SELECT COUNT(*) AS c FROM events e WHERE ${UPCOMING}`, cb),
      events: (cb) =>
        db.query(
          `
          SELECT e.*, o.name AS org_name FROM events e JOIN organizations o ON o.id = e.org_id
          WHERE ${UPCOMING} ORDER BY e.event_date, e.event_time LIMIT ?`,
          [limit],
          cb,
        ),
    },
    (err, results) => {
      if (err) {
        return done(err);
      }
      done(null, { total: results.count[0].c, events: results.events });
    },
  );
}

/* Distinct organization categories, used by the filter chips. done(err, ['Creative', ...]) */
function getAllCategories(done) {
  db.query('SELECT DISTINCT category FROM organizations ORDER BY category', (err, rows) => {
    if (err) {
      return done(err);
    }
    done(
      null,
      rows.map((r) => r.category),
    );
  });
}

/* The month to show for ?month=YYYY-MM (this month when missing or invalid), with prev/next links. */
function monthRange(param) {
  const now = new Date();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(param || ''));
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) - 1 : now.getMonth();
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  return {
    year,
    month,
    first: ymd(new Date(year, month, 1)),
    last: ymd(new Date(year, month + 1, 0)),
    label: `${MON[month]} ${year}`,
    prev: key(new Date(year, month - 1, 1)),
    next: key(new Date(year, month + 1, 1)),
  };
}

/* Weeks (Sunday first) of day cells for the month, each holding the student's events that day. */
function layoutMonth(range, events) {
  const today = ymd(new Date());
  const lead = new Date(range.year, range.month, 1).getDay();
  const days = new Date(range.year, range.month + 1, 0).getDate();
  const cells = Array(lead).fill(null);

  for (let day = 1; day <= days; day += 1) {
    const date = ymd(new Date(range.year, range.month, day));
    cells.push({ day, date, today: date === today, events: events.filter((e) => e.event_date === date) });
  }
  while (cells.length % 7) {
    cells.push(null);
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/* Registers Discover, Apply, Events and RSVP on a portal's router. */
function addSharedPages(router, { view, base }) {
  /* Browse and search organizations */
  function showDiscover(req, res, next) {
    const q = text(req.query.q);

    parallel(
      {
        orgs: (cb) => getOrgs(req.session.user.id, q, cb),
        cats: (cb) => getAllCategories(cb),
      },
      (err, results) => {
        if (err) {
          return next(err);
        }
        res.render(`${view}/discover`, {
          title: 'Discover',
          active: 'discover',
          orgs: results.orgs,
          q,
          cats: results.cats,
        });
      },
    );
  }

  /* The organization's name when filtering by ?org=ID, otherwise null. done(err, name | null) */
  function getFilterName(orgId, done) {
    if (!orgId) {
      return done(null, null);
    }
    db.query('SELECT name FROM organizations WHERE id = ?', [orgId], (err, rows) => {
      if (err) {
        return done(err);
      }
      done(null, rows.length ? rows[0].name : null);
    });
  }

  /* Upcoming events, optionally filtered to one organization (?org=ID) */
  function showEvents(req, res, next) {
    const orgId = Number(req.query.org) || null;
    const range = monthRange(req.query.month);
    const params = [req.session.user.id, req.session.user.id];
    if (orgId) {
      params.push(orgId);
    }

    parallel(
      {
        events: (cb) =>
          db.query(
            `
            SELECT e.*, o.name AS org_name,
              (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
              (SELECT r.status FROM rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS my_status,
              (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'waitlist'
                AND r.seq <= (SELECT m.seq FROM rsvps m WHERE m.event_id = e.id AND m.user_id = ?)) AS wait_position
            FROM events e JOIN organizations o ON o.id = e.org_id
            WHERE ${UPCOMING} ${orgId ? 'AND e.org_id = ?' : ''}
            ORDER BY e.event_date, e.event_time`,
            params,
            cb,
          ),
        filterOrg: (cb) => getFilterName(orgId, cb),
        /* Only events the student joined (going or waitlisted) go on their calendar */
        calendarEvents: (cb) =>
          db.query(
            `
            SELECT e.id, e.title, e.event_date, e.event_time, r.status AS my_status
            FROM rsvps r JOIN events e ON e.id = r.event_id
            WHERE r.user_id = ? AND e.status = 'published' AND e.event_date BETWEEN ? AND ?
            ORDER BY e.event_date, e.event_time`,
            [req.session.user.id, range.first, range.last],
            cb,
          ),
      },
      (err, results) => {
        if (err) {
          return next(err);
        }
        attachProgram(results.events, (err) => {
          if (err) {
            return next(err);
          }
          res.render(`${view}/events`, {
            title: 'Events',
            active: 'events',
            events: results.events,
            filterOrg: results.filterOrg,
            calendar: { ...range, weeks: layoutMonth(range, results.calendarEvents) },
            orgId,
          });
        });
      },
    );
  }

  /*
   * RSVP toggles: a second click cancels the first. When an event is full the student joins
   * the waitlist instead, and the next person in line gets the seat if someone cancels.
   */
  function toggleRsvp(req, res, next) {
    const uid = req.session.user.id;
    const eventId = req.params.id;

    function backToPage() {
      res.redirect(req.get('Referer') || `${base}/events`);
    }

    db.query(
      'SELECT status FROM rsvps WHERE event_id = ? AND user_id = ?',
      [eventId, uid],
      (err, mine) => {
        if (err) {
          return next(err);
        }

        /* Already in: cancel, then offer the freed seat to the waitlist */
        if (mine.length) {
          return db.query(
            'DELETE FROM rsvps WHERE event_id = ? AND user_id = ?',
            [eventId, uid],
            (err) => {
              if (err) {
                return next(err);
              }
              promoteWaitlist(eventId, (err) => {
                if (err) {
                  return next(err);
                }
                flash(req, mine[0].status === 'waitlist' ? 'You left the waitlist.' : 'RSVP cancelled.');
                backToPage();
              });
            },
          );
        }

        db.query(
          `
          SELECT capacity, title,
            (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = events.id AND r.status = 'going') AS going
          FROM events WHERE id = ? AND status = 'published'`,
          [eventId],
          (err, found) => {
            if (err) {
              return next(err);
            }
            if (!found.length) {
              return backToPage();
            }
            const { capacity, going, title } = found[0];
            const full = capacity !== null && going >= capacity;

            db.query(
              'INSERT IGNORE INTO rsvps (event_id, user_id, status) VALUES (?,?,?)',
              [eventId, uid, full ? 'waitlist' : 'going'],
              (err) => {
                if (err) {
                  return next(err);
                }
                flash(
                  req,
                  full
                    ? `${title} is full. You're on the waitlist and we'll notify you if a seat opens.`
                    : `You're going to ${title}.`,
                );
                backToPage();
              },
            );
          },
        );
      },
    );
  }

  /* Calendar file for one published event */
  function downloadEventCalendar(req, res, next) {
    db.query(
      `
      SELECT e.*, o.name AS org_name FROM events e JOIN organizations o ON o.id = e.org_id
      WHERE e.id = ? AND e.status = 'published'`,
      [req.params.id],
      (err, events) => {
        if (err) {
          return next(err);
        }
        if (!events.length) {
          return res.redirect(`${base}/events`);
        }
        sendCalendar(res, events, 'event');
      },
    );
  }

  /* Calendar file for every upcoming event the student is going to */
  function downloadMyCalendar(req, res, next) {
    db.query(
      `
      SELECT e.*, o.name AS org_name
      FROM rsvps r JOIN events e ON e.id = r.event_id JOIN organizations o ON o.id = e.org_id
      WHERE r.user_id = ? AND r.status = 'going' AND ${UPCOMING}
      ORDER BY e.event_date, e.event_time`,
      [req.session.user.id],
      (err, events) => {
        if (err) {
          return next(err);
        }
        sendCalendar(res, events, 'my-events');
      },
    );
  }

  function sendCalendar(res, events, name) {
    buildCalendar(events, (err, ics) => {
      if (err) {
        return res.status(500).send('Could not build the calendar file.');
      }
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="omni-${name}.ics"`);
      res.send(ics);
    });
  }

  router.get('/discover', showDiscover);
  router.post('/apply', applyToOrg);
  router.get('/events', showEvents);
  router.get('/events/calendar.ics', downloadMyCalendar);
  router.get('/events/:id/calendar.ics', downloadEventCalendar);
  router.post('/events/:id/rsvp', toggleRsvp);
}

module.exports = { UPCOMING, getOrgs, getUpcomingSummary, addSharedPages };
