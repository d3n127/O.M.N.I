/* Event reminders: tell everyone who is going the day before (or the day of) an event. */
const db = require('../conn');
const { fmtTime } = require('../utils');

const HOUR = 60 * 60 * 1000;

/* Send one reminder per event, once. done(err, number of events reminded) */
function sendEventReminders(done) {
  db.query(
    `
    SELECT id, title, event_date, event_time, location, event_date = CURDATE() AS today
    FROM events
    WHERE status = 'published' AND reminder_sent = 0
      AND event_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 DAY)`,
    (err, events) => {
      if (err) {
        return done(err);
      }

      let index = 0;
      function next(err) {
        if (err || index === events.length) {
          return done(err, events.length);
        }
        const e = events[index];
        index += 1;

        const when = e.today ? 'today' : 'tomorrow';
        const message =
          `Reminder: ${e.title} is ${when} at ${fmtTime(e.event_time)} · ${e.location}`.slice(0, 255);

        /* Mark it first so a slow run can never send the same reminder twice */
        db.query('UPDATE events SET reminder_sent = 1 WHERE id = ?', [e.id], (err) => {
          if (err) {
            return next(err);
          }
          db.query(
            "INSERT INTO notifications (user_id, message) SELECT user_id, ? FROM rsvps WHERE event_id = ? AND status = 'going'",
            [message, e.id],
            next,
          );
        });
      }
      next();
    },
  );
}

/* Check now, then every hour. */
function startReminders() {
  const run = () =>
    sendEventReminders((err) => {
      if (err) {
        console.error('Event reminders failed:', err.message);
      }
    });
  run();
  setInterval(run, HOUR).unref();
}

module.exports = { sendEventReminders, startReminders };
