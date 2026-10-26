/* Apply-to-organization handler, shared by the student and non-member portals. */
const db = require('../conn');
const { text } = require('../utils');

const MAX_ANSWER = 500;

/* Create the application, or re-open a rejected one as pending. done(err, applicationId) */
function saveApplication(existing, orgId, userId, intro, done) {
  if (existing) {
    return db.query(
      "UPDATE applications SET intro = ?, status = 'pending', created_at = NOW(), reviewed_at = NULL WHERE id = ?",
      [intro, existing.id],
      (err) => done(err, existing.id),
    );
  }
  db.query(
    'INSERT INTO applications (org_id, user_id, intro) VALUES (?,?,?)',
    [orgId, userId, intro],
    (err, result) => done(err, err ? null : result.insertId),
  );
}

/* Keep the applicant's answers next to the question text they were asked. done(err) */
function saveAnswers(applicationId, questions, answers, done) {
  db.query('DELETE FROM application_answers WHERE application_id = ?', [applicationId], (err) => {
    if (err || !questions.length) {
      return done(err);
    }
    const rows = questions.map((q, i) => [applicationId, i, q, answers[i]]);
    db.query(
      'INSERT INTO application_answers (application_id, position, question, answer) VALUES ?',
      [rows],
      (err) => done(err),
    );
  });
}

/* Replies with JSON: { ok: true, name } on success, or { error } with an HTTP error status. */
function applyToOrg(req, res, next) {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  if (user.role !== 'student') {
    return res.status(403).json({ error: 'Only student accounts can apply to an organization.' });
  }

  const orgId = Number(req.body.org_id);
  const intro = text(req.body.intro);
  if (!intro) {
    return res
      .status(400)
      .json({ error: 'Write a short introduction so the team can get to know you.' });
  }
  if (!req.body.agree) {
    return res.status(400).json({ error: 'Agree to share your student profile to continue.' });
  }

  db.query('SELECT * FROM organizations WHERE id = ?', [orgId], (err, orgs) => {
    if (err) {
      return next(err);
    }
    if (!orgs.length) {
      return res.status(404).json({ error: 'That organization no longer exists.' });
    }
    const org = orgs[0];

    db.query(
      'SELECT question FROM org_questions WHERE org_id = ? ORDER BY position, id',
      [orgId],
      (err, questionRows) => {
        if (err) {
          return next(err);
        }
        const questions = questionRows.map((q) => q.question);
        const answers = Array.isArray(req.body.answers)
          ? req.body.answers.map((a) => text(a, MAX_ANSWER))
          : [];

        if (answers.length !== questions.length) {
          return res
            .status(400)
            .json({ error: `${org.name} changed its questions. Reload the page and try again.` });
        }
        if (answers.some((a) => !a)) {
          return res.status(400).json({ error: 'Answer every question so the team can review you.' });
        }
        submit(org, questions, answers);
      },
    );
  });

  function submit(org, questions, answers) {
    db.query(
      'SELECT id FROM memberships WHERE org_id = ? AND user_id = ?',
      [orgId, user.id],
      (err, memberships) => {
        if (err) {
          return next(err);
        }
        if (memberships.length) {
          return res.status(400).json({ error: `You are already a member of ${org.name}.` });
        }

        /* One application per org. A rejected one can be re-submitted; anything else cannot. */
        db.query(
          'SELECT id, status FROM applications WHERE org_id = ? AND user_id = ?',
          [orgId, user.id],
          (err, found) => {
            if (err) {
              return next(err);
            }
            const existing = found[0];
            if (existing && existing.status !== 'rejected') {
              return res
                .status(400)
                .json({ error: 'You already applied. Check the Applications tab for updates.' });
            }

            saveApplication(existing, orgId, user.id, intro, (err, applicationId) => {
              if (err) {
                return next(err);
              }

              saveAnswers(applicationId, questions, answers, (err) => {
                if (err) {
                  return next(err);
                }

                /* Tell the organization's adviser(s) */
                db.query(
                  "INSERT INTO notifications (user_id, message) SELECT id, ? FROM users WHERE role = 'adviser' AND org_id = ?",
                  [`${user.name} applied to join ${org.name}.`, orgId],
                  (err) => {
                    if (err) {
                      return next(err);
                    }
                    res.json({ ok: true, name: org.name });
                  },
                );
              });
            });
          },
        );
      },
    );
  }
}

module.exports = { applyToOrg };
