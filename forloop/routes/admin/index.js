/*
 * Adviser portal (/admin): manages the adviser's one organization.
 * Sections: Overview, Organization profile, Members, Officers, Applications, Events, Reports.
 *
 * Functions that read the database finish by calling done(err, result).
 */
const express = require('express');
const db = require('../../conn');
const { MON, DEPT_NAMES, flash, text, cleanEmail, ymd, parallel } = require('../../utils');
const { requireRole } = require('../auth');
const { UPCOMING } = require('../portal');
const { parseProgram, programToText, saveProgram, attachProgram } = require('../program');
const { promoteWaitlist } = require('../rsvp');

const MAX_QUESTIONS = 5;

const router = express.Router();

const CATEGORIES = ['Technology', 'Creative', 'Academic', 'Sports', 'Community', 'Business'];

/* ---------- Setup for every admin page ---------- */

/* Load the adviser's organization, its roles and the pending-applications badge. */
function loadOrganization(req, res, next) {
  db.query('SELECT * FROM organizations WHERE id = ?', [req.session.user.org_id], (err, orgs) => {
    if (err) {
      return next(err);
    }
    if (!orgs.length) {
      return req.session.destroy(() => res.redirect('/'));
    }
    const org = orgs[0];

    parallel(
      {
        pending: (cb) =>
          db.query(
            "SELECT COUNT(*) AS c FROM applications WHERE org_id = ? AND status = 'pending'",
            [org.id],
            cb,
          ),
        roles: (cb) =>
          db.query('SELECT * FROM org_roles WHERE org_id = ? ORDER BY precedence, id', [org.id], cb),
      },
      (err, results) => {
        if (err) {
          return next(err);
        }
        res.locals.org = org;
        res.locals.orgRoles = results.roles;
        res.locals.badge = results.pending[0].c;
        next();
      },
    );
  });
}

/* Role given to new members: the lowest-ranked one (highest precedence number). */
function defaultMemberRole(roles) {
  const lowest = [...roles].sort((a, b) => b.precedence - a.precedence)[0];
  return lowest ? lowest.role_title : 'Member';
}

/* Add a student to an organization. done(err, added) where added is false if they already were a member. */
function addMember(orgId, userId, roleTitle, done) {
  db.query(
    'INSERT IGNORE INTO memberships (org_id, user_id, role_title, joined_at) VALUES (?,?,?, CURDATE())',
    [orgId, userId, roleTitle],
    (err, result) => {
      if (err) {
        return done(err);
      }
      done(null, result.affectedRows > 0);
    },
  );
}

function notifyUser(userId, message, done) {
  db.query('INSERT INTO notifications (user_id, message) VALUES (?,?)', [userId, message], done);
}

/* ---------- Stats (used by Overview and Reports) ---------- */

/* Event and RSVP totals for published events; `extraCondition` narrows which count. done(err, { events, rsvps }) */
function countEvents(orgId, extraCondition, done) {
  db.query(
    `
    SELECT COUNT(DISTINCT e.id) AS events, COUNT(r.user_id) AS rsvps
    FROM events e LEFT JOIN rsvps r ON r.event_id = e.id AND r.status = 'going'
    WHERE e.org_id = ? AND e.status = 'published' ${extraCondition}`,
    [orgId],
    (err, rows) => {
      if (err) {
        return done(err);
      }
      done(null, rows[0]);
    },
  );
}

/* done(err, stats) */
function orgStats(org, done) {
  parallel(
    {
      members: (cb) =>
        db.query(
          "SELECT COUNT(*) AS total, SUM(joined_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS fresh FROM memberships WHERE org_id = ?",
          [org.id],
          cb,
        ),
      pending: (cb) =>
        db.query(
          "SELECT COUNT(*) AS c FROM applications WHERE org_id = ? AND status = 'pending'",
          [org.id],
          cb,
        ),
      decisions: (cb) =>
        db.query(
          "SELECT SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected FROM applications WHERE org_id = ?",
          [org.id],
          cb,
        ),
      upcoming: (cb) => countEvents(org.id, 'AND e.event_date >= CURDATE()', cb),
      allEvents: (cb) => countEvents(org.id, '', cb),
      checkins: (cb) =>
        db.query(
          `
          SELECT COUNT(*) AS going, COALESCE(SUM(r.attended), 0) AS attended
          FROM rsvps r JOIN events e ON e.id = r.event_id
          WHERE e.org_id = ? AND e.status = 'published' AND e.attendance_taken = 1 AND r.status = 'going'`,
          [org.id],
          cb,
        ),
    },
    (err, results) => {
      if (err) {
        return done(err);
      }
      const members = results.members[0];
      const decisions = results.decisions[0];
      const { upcoming, allEvents } = results;

      const memberCount = Number(members.total);
      const approved = Number(decisions.approved || 0);
      const decided = approved + Number(decisions.rejected || 0);

      /*
       * Once advisers check people in, attendance is the share of RSVPs who showed up.
       * Until then it is the percent of members who RSVPed to the average event.
       */
      const checkins = results.checkins[0];
      const hasCheckins = Number(checkins.going) > 0;
      const attendance = hasCheckins
        ? Math.round((Number(checkins.attended) / Number(checkins.going)) * 100)
        : allEvents.events && memberCount
          ? Math.min(100, Math.round((allEvents.rsvps / (allEvents.events * memberCount)) * 100))
          : 0;
      /* Percent of decided applications that were approved */
      const acceptance = decided ? Math.round((approved / decided) * 100) : 0;
      /* Satisfaction is out of 5, so x20 makes it a percent */
      const score = Math.round((attendance + acceptance + Number(org.satisfaction) * 20) / 3);

      done(null, {
        members: memberCount,
        fresh: Number(members.fresh || 0),
        pending: results.pending[0].c,
        upcoming: upcoming.events,
        upcomingRsvps: upcoming.rsvps,
        attendance,
        attendanceBasis: hasCheckins ? 'checkin' : 'rsvp',
        acceptance,
        score,
      });
    },
  );
}

/* New members per month for the last 6 months, oldest first. done(err, months) */
function memberGrowth(orgId, done) {
  const now = new Date();
  const months = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({ key: ymd(d).slice(0, 7), label: MON[d.getMonth()], count: 0 });
  }

  db.query(
    "SELECT DATE_FORMAT(joined_at, '%Y-%m') AS ym, COUNT(*) AS c FROM memberships WHERE org_id = ? AND joined_at >= ? GROUP BY ym",
    [orgId, months[0].key + '-01'],
    (err, rows) => {
      if (err) {
        return done(err);
      }
      for (const row of rows) {
        const month = months.find((m) => m.key === row.ym);
        if (month) {
          month.count = Number(row.c);
        }
      }
      done(null, months);
    },
  );
}

/* ---------- Overview ---------- */

function showOverview(req, res, next) {
  const org = res.locals.org;

  parallel(
    {
      stats: (cb) => orgStats(org, cb),
      recent: (cb) =>
        db.query(
          `
          SELECT a.*, u.full_name, u.student_id, u.program, u.year_level
          FROM applications a JOIN users u ON u.id = a.user_id
          WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 3`,
          [org.id],
          cb,
        ),
      /* The next 5 upcoming events; the first one is featured */
      upcoming: (cb) =>
        db.query(
          `
          SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS rsvps
          FROM events e WHERE e.org_id = ? AND ${UPCOMING}
          ORDER BY e.event_date, e.event_time LIMIT 5`,
          [org.id],
          cb,
        ),
    },
    (err, results) => {
      if (err) {
        return next(err);
      }
      const featured = results.upcoming[0] || null;

      /* Who is going to the featured event */
      function renderOverview(going) {
        const now = new Date();
        const hour = now.getHours();
        let greeting = 'Good evening';
        if (hour < 12) {
          greeting = 'Good morning';
        } else if (hour < 18) {
          greeting = 'Good afternoon';
        }

        res.render('admin/overview', {
          title: 'Overview',
          active: 'overview',
          stats: results.stats,
          recent: results.recent,
          featured,
          upcoming: results.upcoming,
          going,
          goingCount: featured ? featured.rsvps : 0,
          greeting,
          today: now.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          }),
          firstName: req.session.user.name.split(' ')[0],
        });
      }

      if (!featured) {
        return renderOverview([]);
      }
      db.query(
        "SELECT u.full_name FROM rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? AND r.status = 'going' LIMIT 3",
        [featured.id],
        (err, going) => {
          if (err) {
            return next(err);
          }
          renderOverview(going);
        },
      );
    },
  );
}

/* ---------- Organization profile ---------- */

function showOrganization(req, res, next) {
  db.query(
    'SELECT COUNT(*) AS c FROM memberships WHERE org_id = ?',
    [res.locals.org.id],
    (err, rows) => {
      if (err) {
        return next(err);
      }
      res.render('admin/organization', {
        title: 'Organization',
        active: 'organization',
        memberCount: rows[0].c,
        categories: CATEGORIES,
        departments: DEPT_NAMES,
      });
    },
  );
}

function saveOrganization(req, res, next) {
  const name = text(req.body.name);
  if (!name) {
    flash(req, 'Organization name cannot be empty.', 'err');
    return res.redirect('/admin/organization');
  }

  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Technology';
  /* Eligibility is "International" (any department) or one department */
  const isValidEligibility =
    req.body.eligibility === 'International' || DEPT_NAMES.includes(req.body.eligibility);
  const eligibility = isValidEligibility ? req.body.eligibility : 'International';
  /* Orgs with an uploaded logo image (a path) keep it; others edit their text logo */
  const logo = res.locals.org.logo_img.startsWith('/')
    ? res.locals.org.logo_img
    : text(req.body.logo_text, 4) || name.slice(0, 2).toUpperCase();

  db.query(
    'UPDATE organizations SET name = ?, description = ?, category = ?, tags = ?, eligibility = ?, logo_img = ?, meeting_schedule = ? WHERE id = ?',
    [
      name,
      text(req.body.description),
      category,
      text(req.body.tags, 160),
      eligibility,
      logo,
      text(req.body.meeting_schedule) || 'To be announced',
      res.locals.org.id,
    ],
    (err) => {
      if (err) {
        return next(err);
      }
      flash(req, 'Changes saved. Students can see your updated profile now.');
      res.redirect('/admin/organization');
    },
  );
}

/* ---------- Members ---------- */

function showMembers(req, res, next) {
  const q = text(req.query.q);
  const params = [res.locals.org.id];
  let where = '';
  if (q) {
    where = 'AND (u.full_name LIKE ? OR u.email LIKE ? OR m.role_title LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  /* Highest-ranked roles first, then by join date */
  db.query(
    `
    SELECT m.id AS mid, m.role_title, m.joined_at, u.full_name, u.email
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN org_roles o ON o.org_id = m.org_id AND o.role_title = m.role_title
    WHERE m.org_id = ? ${where}
    ORDER BY COALESCE(o.precedence, 999), m.joined_at`,
    params,
    (err, members) => {
      if (err) {
        return next(err);
      }
      res.render('admin/members', {
        title: 'Members',
        active: 'members',
        members,
        q,
        roles: res.locals.orgRoles,
      });
    },
  );
}

/* Add an existing student account straight to the organization */
function inviteMember(req, res, next) {
  const { org, orgRoles } = res.locals;
  const email = cleanEmail(req.body.email);

  db.query(
    "SELECT id, full_name FROM users WHERE email = ? AND role = 'student'",
    [email],
    (err, students) => {
      if (err) {
        return next(err);
      }
      if (!students.length) {
        flash(req, 'No student account uses that email yet. Ask them to sign up first.', 'err');
        return res.redirect('/admin/members');
      }
      const student = students[0];

      addMember(org.id, student.id, defaultMemberRole(orgRoles), (err, added) => {
        if (err) {
          return next(err);
        }
        if (!added) {
          flash(req, `${student.full_name} is already a member.`, 'err');
          return res.redirect('/admin/members');
        }

        notifyUser(student.id, `You were added to ${org.name}. Welcome!`, (err) => {
          if (err) {
            return next(err);
          }
          flash(req, `${student.full_name} joined ${org.name}.`);
          res.redirect('/admin/members');
        });
      });
    },
  );
}

function changeMemberRole(req, res, next) {
  const validTitles = res.locals.orgRoles.map((r) => r.role_title);
  if (!validTitles.includes(req.body.role)) {
    return res.redirect('/admin/members');
  }

  db.query(
    'UPDATE memberships SET role_title = ? WHERE id = ? AND org_id = ?',
    [req.body.role, req.params.mid, res.locals.org.id],
    (err) => {
      if (err) {
        return next(err);
      }
      flash(req, 'Role updated.');
      res.redirect('/admin/members');
    },
  );
}

function removeMember(req, res, next) {
  db.query(
    'DELETE FROM memberships WHERE id = ? AND org_id = ?',
    [req.params.mid, res.locals.org.id],
    (err) => {
      if (err) {
        return next(err);
      }
      flash(req, 'Member removed.');
      res.redirect('/admin/members');
    },
  );
}

/* ---------- Officer hierarchy ---------- */
/* Lower precedence = higher rank (1 is the top role). */

function showOfficers(req, res, next) {
  db.query(
    `
    SELECT o.role_title, COUNT(m.id) AS n
    FROM org_roles o LEFT JOIN memberships m ON m.org_id = o.org_id AND m.role_title = o.role_title
    WHERE o.org_id = ? GROUP BY o.id`,
    [res.locals.org.id],
    (err, usage) => {
      if (err) {
        return next(err);
      }

      /* How many members hold each role, by title */
      const useCount = {};
      for (const row of usage) {
        useCount[row.role_title] = Number(row.n);
      }
      res.render('admin/officers', {
        title: 'Officers',
        active: 'officers',
        roles: res.locals.orgRoles,
        useCount,
      });
    },
  );
}

/* Each action finishes with done(err, [message, type]): the flash message to show. */

/* Swap a role's precedence with its neighbour above or below */
function moveRole(orgId, roles, body, done) {
  const role = roles.find((r) => r.id === Number(body.role_id));
  if (!role) {
    return done(null, ['Role not found.', 'err']);
  }

  const step = body.dir === 'up' ? -1 : 1;
  const neighbour = roles.find((r) => r.precedence === role.precedence + step);
  if (!neighbour) {
    return done(null, ['Cannot move further.', 'err']);
  }

  const setPrecedence = 'UPDATE org_roles SET precedence = ? WHERE id = ? AND org_id = ?';
  db.query(setPrecedence, [neighbour.precedence, role.id, orgId], (err) => {
    if (err) {
      return done(err);
    }
    db.query(setPrecedence, [role.precedence, neighbour.id, orgId], (err) => {
      if (err) {
        return done(err);
      }
      done(null, [`Role “${role.role_title}” moved ${body.dir}.`, 'ok']);
    });
  });
}

/* Add a new officer role at the bottom of the ranking */
function addRole(orgId, roles, body, done) {
  const title = text(body.role_title);
  if (!title) {
    return done(null, ['Role title cannot be empty.', 'err']);
  }
  if (roles.some((r) => r.role_title === title)) {
    return done(null, ['That role already exists.', 'err']);
  }

  const nextPrecedence = Math.max(0, ...roles.map((r) => r.precedence)) + 1;
  db.query(
    'INSERT INTO org_roles (org_id, role_title, precedence, is_officer) VALUES (?,?,?,1)',
    [orgId, title, nextPrecedence],
    (err) => {
      if (err) {
        return done(err);
      }
      done(null, [`Role “${title}” added.`, 'ok']);
    },
  );
}

/* Remove a role, unless it is the last one or members still hold it */
function removeRole(orgId, roles, body, done) {
  const role = roles.find((r) => r.id === Number(body.role_id));
  if (!role) {
    return done(null, ['Role not found.', 'err']);
  }
  if (roles.length <= 1) {
    return done(null, ['Keep at least one role.', 'err']);
  }

  db.query(
    'SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role_title = ?',
    [orgId, role.role_title],
    (err, rows) => {
      if (err) {
        return done(err);
      }
      const holders = Number(rows[0].n);
      if (holders > 0) {
        return done(null, [
          `Cannot remove “${role.role_title}”: ${holders} member(s) currently hold it.`,
          'err',
        ]);
      }

      db.query('DELETE FROM org_roles WHERE id = ? AND org_id = ?', [role.id, orgId], (err) => {
        if (err) {
          return done(err);
        }
        done(null, [`Role “${role.role_title}” removed.`, 'ok']);
      });
    },
  );
}

const ROLE_ACTIONS = { reorder: moveRole, add: addRole, remove: removeRole };

function changeOfficers(req, res, next) {
  const action = ROLE_ACTIONS[req.body.action];
  if (!action) {
    return res.redirect('/admin/officers');
  }

  action(res.locals.org.id, res.locals.orgRoles, req.body, (err, result) => {
    if (err) {
      return next(err);
    }
    const [message, type] = result;
    flash(req, message, type);
    res.redirect('/admin/officers');
  });
}

/* ---------- Applications ---------- */

function showApplications(req, res, next) {
  db.query(
    `
    SELECT a.*, u.full_name, u.student_id, u.program, u.year_level
    FROM applications a JOIN users u ON u.id = a.user_id
    WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC`,
    [res.locals.org.id],
    (err, apps) => {
      if (err) {
        return next(err);
      }
      apps.forEach((a) => {
        a.answers = [];
      });

      parallel(
        {
          questions: (cb) =>
            db.query(
              'SELECT question FROM org_questions WHERE org_id = ? ORDER BY position, id',
              [res.locals.org.id],
              cb,
            ),
          answers: (cb) =>
            apps.length
              ? db.query(
                  'SELECT * FROM application_answers WHERE application_id IN (?) ORDER BY position, id',
                  [apps.map((a) => a.id)],
                  cb,
                )
              : cb(null, []),
        },
        (err, results) => {
          if (err) {
            return next(err);
          }
          results.answers.forEach((row) => {
            apps.find((a) => a.id === row.application_id).answers.push(row);
          });
          res.render('admin/applications', {
            title: 'Applications',
            active: 'applications',
            apps,
            questions: results.questions.map((q) => q.question),
            maxQuestions: MAX_QUESTIONS,
          });
        },
      );
    },
  );
}

/* One question per line, up to MAX_QUESTIONS. Applicants see them in the apply popup. */
function saveQuestions(req, res, next) {
  const orgId = res.locals.org.id;
  const questions = String(req.body.questions || '')
    .split(/\r?\n/)
    .map((q) => text(q, 200))
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS);

  db.query('DELETE FROM org_questions WHERE org_id = ?', [orgId], (err) => {
    if (err) {
      return next(err);
    }

    function finish() {
      flash(
        req,
        questions.length
          ? `Saved ${questions.length} application question${questions.length === 1 ? '' : 's'}.`
          : 'Application questions cleared. Applicants only write an introduction.',
      );
      res.redirect('/admin/applications');
    }

    if (!questions.length) {
      return finish();
    }
    db.query(
      'INSERT INTO org_questions (org_id, position, question) VALUES ?',
      [questions.map((q, i) => [orgId, i, q])],
      (err) => {
        if (err) {
          return next(err);
        }
        finish();
      },
    );
  });
}

/* Approve (adds the student as a member) or decline a pending application */
function reviewApplication(req, res, next) {
  const { id, action } = req.params;
  const { org, orgRoles } = res.locals;
  const back = '/admin/applications';

  if (!['approve', 'decline'].includes(action)) {
    return res.redirect(back);
  }

  db.query(
    'SELECT * FROM applications WHERE id = ? AND org_id = ?',
    [id, org.id],
    (err, found) => {
      if (err) {
        return next(err);
      }
      const app = found[0];
      if (!app || app.status !== 'pending') {
        return res.redirect(back);
      }
      const approved = action === 'approve';

      /* Last step: tell the student and report back to the adviser */
      function notifyStudent() {
        const message = approved
          ? `${org.name} accepted your application. Welcome aboard!`
          : `${org.name} declined your application. You can revise it and apply again.`;

        notifyUser(app.user_id, message, (err) => {
          if (err) {
            return next(err);
          }
          flash(
            req,
            approved ? 'Application approved. They are now a member.' : 'Application declined.',
          );
          res.redirect(back);
        });
      }

      db.query(
        'UPDATE applications SET status = ?, reviewed_at = NOW() WHERE id = ?',
        [approved ? 'approved' : 'rejected', id],
        (err) => {
          if (err) {
            return next(err);
          }
          if (!approved) {
            return notifyStudent();
          }
          addMember(org.id, app.user_id, defaultMemberRole(orgRoles), (err) => {
            if (err) {
              return next(err);
            }
            notifyStudent();
          });
        },
      );
    },
  );
}

/* ---------- Events ---------- */

function showEvents(req, res, next) {
  db.query(
    `
    SELECT e.*,
      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS rsvps,
      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'waitlist') AS waitlist,
      (SELECT COALESCE(SUM(r.attended), 0) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS attended
    FROM events e WHERE e.org_id = ? ORDER BY e.event_date, e.event_time`,
    [res.locals.org.id],
    (err, events) => {
      if (err) {
        return next(err);
      }
      attachProgram(events, (err) => {
        if (err) {
          return next(err);
        }
        events.forEach((e) => {
          e.programText = programToText(e.program);
        });
        res.render('admin/events', { title: 'Events', active: 'events', events });
      });
    },
  );
}

/* Seats: a whole number from 1 to 10000, or null for no limit. */
function readCapacity(value) {
  const seats = parseInt(value, 10);
  return seats >= 1 ? Math.min(seats, 10000) : null;
}

/* Clean the event form. Returns null when title, date or time is missing or malformed. */
function readEvent(body) {
  const event = {
    title: text(body.title),
    date: String(body.event_date || ''),
    time: String(body.event_time || ''),
    location: text(body.location) || 'TBA',
    description: text(body.description),
    status: body.status === 'published' ? 'published' : 'draft',
    program: parseProgram(body.program),
    capacity: readCapacity(body.capacity),
  };
  const isValid =
    event.title && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && /^\d{2}:\d{2}/.test(event.time);
  return isValid ? event : null;
}

/* Tell every member about a newly published event. done(err) */
function notifyMembers(org, title, done) {
  db.query(
    'INSERT INTO notifications (user_id, message) SELECT user_id, ? FROM memberships WHERE org_id = ?',
    [`New event from ${org.name}: ${title}`, org.id],
    done,
  );
}

function createEvent(req, res, next) {
  const event = readEvent(req.body);
  if (!event) {
    flash(req, 'Add a title, date and time to create the event.', 'err');
    return res.redirect('/admin/events');
  }

  db.query(
    'INSERT INTO events (org_id, title, event_date, event_time, location, description, status, capacity) VALUES (?,?,?,?,?,?,?,?)',
    [
      res.locals.org.id,
      event.title,
      event.date,
      event.time,
      event.location,
      event.description,
      event.status,
      event.capacity,
    ],
    (err, result) => {
      if (err) {
        return next(err);
      }
      saveProgram(result.insertId, event.program, (err) => {
        if (err) {
          return next(err);
        }
        if (event.status !== 'published') {
          flash(req, 'Draft saved.');
          return res.redirect('/admin/events');
        }

        notifyMembers(res.locals.org, event.title, (err) => {
          if (err) {
            return next(err);
          }
          flash(req, 'Event published. Members were notified.');
          res.redirect('/admin/events');
        });
      });
    },
  );
}

function updateEvent(req, res, next) {
  const event = readEvent(req.body);
  if (!event) {
    flash(req, 'Add a title, date and time to save the event.', 'err');
    return res.redirect('/admin/events');
  }

  db.query(
    'SELECT status FROM events WHERE id = ? AND org_id = ?',
    [req.params.id, res.locals.org.id],
    (err, found) => {
      if (err) {
        return next(err);
      }
      if (!found.length) {
        return res.redirect('/admin/events');
      }
      const wasPublished = found[0].status === 'published';

      function finish() {
        flash(req, 'Event saved.');
        res.redirect('/admin/events');
      }

      db.query(
        'UPDATE events SET reminder_sent = IF(event_date = ?, reminder_sent, 0), title = ?, event_date = ?, event_time = ?, location = ?, description = ?, status = ?, capacity = ? WHERE id = ?',
        [
          event.date,
          event.title,
          event.date,
          event.time,
          event.location,
          event.description,
          event.status,
          event.capacity,
          req.params.id,
        ],
        (err) => {
          if (err) {
            return next(err);
          }
          saveProgram(req.params.id, event.program, (err) => {
            if (err) {
              return next(err);
            }
            /* A higher capacity may free seats for people on the waitlist */
            promoteWaitlist(req.params.id, (err) => {
              if (err) {
                return next(err);
              }
              /* Members are only notified the first time an event is published */
              if (wasPublished || event.status !== 'published') {
                return finish();
              }
              notifyMembers(res.locals.org, event.title, (err) => {
                if (err) {
                  return next(err);
                }
                finish();
              });
            });
          });
        },
      );
    },
  );
}

function deleteEvent(req, res, next) {
  db.query(
    'DELETE FROM events WHERE id = ? AND org_id = ?',
    [req.params.id, res.locals.org.id],
    (err) => {
      if (err) {
        return next(err);
      }
      flash(req, 'Event deleted.');
      res.redirect('/admin/events');
    },
  );
}

/* ---------- Attendance ---------- */

function showAttendance(req, res, next) {
  db.query(
    'SELECT * FROM events WHERE id = ? AND org_id = ?',
    [req.params.id, res.locals.org.id],
    (err, found) => {
      if (err) {
        return next(err);
      }
      if (!found.length) {
        return res.redirect('/admin/events');
      }

      db.query(
        `
        SELECT r.user_id, r.status, r.attended, u.full_name, u.student_id, u.program, u.year_level
        FROM rsvps r JOIN users u ON u.id = r.user_id
        WHERE r.event_id = ? ORDER BY r.seq`,
        [req.params.id],
        (err, people) => {
          if (err) {
            return next(err);
          }
          res.render('admin/attendance', {
            title: 'Attendance',
            active: 'events',
            event: found[0],
            going: people.filter((p) => p.status === 'going'),
            waitlist: people.filter((p) => p.status === 'waitlist'),
          });
        },
      );
    },
  );
}

/* The ticked boxes are who showed up; everyone else going is marked absent. */
function saveAttendance(req, res, next) {
  const eventId = req.params.id;
  const back = `/admin/events/${eventId}/attendance`;
  const present = [].concat(req.body.attended || []).map(Number).filter((id) => id > 0);

  db.query(
    'SELECT id FROM events WHERE id = ? AND org_id = ?',
    [eventId, res.locals.org.id],
    (err, found) => {
      if (err) {
        return next(err);
      }
      if (!found.length) {
        return res.redirect('/admin/events');
      }

      db.query(
        "UPDATE rsvps SET attended = (user_id IN (?)) WHERE event_id = ? AND status = 'going'",
        [present.length ? present : [0], eventId],
        (err, result) => {
          if (err) {
            return next(err);
          }
          db.query('UPDATE events SET attendance_taken = 1 WHERE id = ?', [eventId], (err) => {
            if (err) {
              return next(err);
            }
            flash(req, `Attendance saved: ${present.length} of ${result.affectedRows} checked in.`);
            res.redirect(back);
          });
        },
      );
    },
  );
}

/* ---------- Announcements ---------- */

function showAnnouncements(req, res, next) {
  db.query(
    'SELECT * FROM announcements WHERE org_id = ? ORDER BY created_at DESC, id DESC',
    [res.locals.org.id],
    (err, announcements) => {
      if (err) {
        return next(err);
      }
      res.render('admin/announcements', {
        title: 'Announcements',
        active: 'announcements',
        announcements,
      });
    },
  );
}

function createAnnouncement(req, res, next) {
  const { org } = res.locals;
  const title = text(req.body.title, 140);
  const body = text(req.body.body, 2000);
  if (!title) {
    flash(req, 'Give the announcement a title.', 'err');
    return res.redirect('/admin/announcements');
  }

  db.query(
    'INSERT INTO announcements (org_id, title, body) VALUES (?,?,?)',
    [org.id, title, body],
    (err) => {
      if (err) {
        return next(err);
      }
      db.query(
        'INSERT INTO notifications (user_id, message) SELECT user_id, ? FROM memberships WHERE org_id = ?',
        [`${org.name}: ${title}`.slice(0, 255), org.id],
        (err, result) => {
          if (err) {
            return next(err);
          }
          flash(
            req,
            `Announcement posted. ${result.affectedRows} member${result.affectedRows === 1 ? ' was' : 's were'} notified.`,
          );
          res.redirect('/admin/announcements');
        },
      );
    },
  );
}

function deleteAnnouncement(req, res, next) {
  db.query(
    'DELETE FROM announcements WHERE id = ? AND org_id = ?',
    [req.params.id, res.locals.org.id],
    (err) => {
      if (err) {
        return next(err);
      }
      flash(req, 'Announcement deleted.');
      res.redirect('/admin/announcements');
    },
  );
}

/* ---------- Reports ---------- */

function showReports(req, res, next) {
  parallel(
    {
      stats: (cb) => orgStats(res.locals.org, cb),
      months: (cb) => memberGrowth(res.locals.org.id, cb),
      events: (cb) =>
        db.query(
          `
          SELECT e.id, e.title, e.event_date, e.capacity, e.attendance_taken,
            (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going,
            (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'waitlist') AS waitlist,
            (SELECT COALESCE(SUM(r.attended), 0) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS attended
          FROM events e
          WHERE e.org_id = ? AND e.status = 'published' AND e.event_date <= CURDATE()
          ORDER BY e.event_date DESC, e.id DESC LIMIT 6`,
          [res.locals.org.id],
          cb,
        ),
    },
    (err, results) => {
      if (err) {
        return next(err);
      }
      res.render('admin/reports', {
        title: 'Reports',
        active: 'reports',
        stats: results.stats,
        events: results.events,
        months: results.months,
        max: Math.max(1, ...results.months.map((m) => m.count)),
      });
    },
  );
}

/* Download the same numbers as a CSV file */
function exportReport(req, res, next) {
  const org = res.locals.org;

  parallel(
    {
      stats: (cb) => orgStats(org, cb),
      months: (cb) => memberGrowth(org.id, cb),
    },
    (err, results) => {
      if (err) {
        return next(err);
      }
      const { stats, months } = results;

      const lines = [
        `Report for ${org.name}`,
        '',
        'Metric,Value',
        `Total members,${stats.members}`,
        `Pending applications,${stats.pending}`,
        `Upcoming events,${stats.upcoming}`,
        `Application acceptance %,${stats.acceptance}`,
        `${stats.attendanceBasis === 'checkin' ? 'Event check-in rate' : 'Event RSVP rate'} %,${stats.attendance}`,
        `Member satisfaction,${org.satisfaction}`,
        '',
        'Month,New members',
        ...months.map((m) => `${m.label},${m.count}`),
      ];

      const fileName = org.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}-report.csv"`);
      res.send(lines.join('\n'));
    },
  );
}

/* ---------- Routes ---------- */
router.use(requireRole('adviser'));
router.use(loadOrganization);
router.get('/', showOverview);
router.get('/organization', showOrganization);
router.post('/organization', saveOrganization);
router.get('/members', showMembers);
router.post('/members/invite', inviteMember);
router.post('/members/:mid/role', changeMemberRole);
router.post('/members/:mid/remove', removeMember);
router.get('/officers', showOfficers);
router.post('/officers', changeOfficers);
router.get('/applications', showApplications);
router.post('/applications/questions', saveQuestions);
router.post('/applications/:id/:action', reviewApplication);
router.get('/events', showEvents);
router.post('/events', createEvent);
router.get('/events/:id/attendance', showAttendance);
router.post('/events/:id/attendance', saveAttendance);
router.post('/events/:id', updateEvent);
router.get('/announcements', showAnnouncements);
router.post('/announcements', createAnnouncement);
router.post('/announcements/:id/delete', deleteAnnouncement);
router.post('/events/:id/delete', deleteEvent);
router.get('/reports', showReports);
router.get('/reports/export', exportReport);

module.exports = router;
