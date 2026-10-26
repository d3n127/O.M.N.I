/* Event seats: moving people off the waitlist when room opens up. */
const db = require('../conn');

/*
 * Fill any free seats from the waitlist, oldest first, and tell the people who got in.
 * Call it after someone cancels or an adviser raises the capacity. done(err)
 */
function promoteWaitlist(eventId, done) {
  db.query(
    `
    SELECT e.title, e.capacity,
      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going
    FROM events e WHERE e.id = ?`,
    [eventId],
    (err, found) => {
      if (err || !found.length) {
        return done(err);
      }
      const { title, capacity, going } = found[0];
      const seats = capacity === null ? 1000000 : capacity - going;
      if (seats <= 0) {
        return done(null);
      }

      db.query(
        "SELECT user_id FROM rsvps WHERE event_id = ? AND status = 'waitlist' ORDER BY seq LIMIT ?",
        [eventId, seats],
        (err, waiting) => {
          if (err || !waiting.length) {
            return done(err);
          }
          const userIds = waiting.map((w) => w.user_id);

          db.query(
            "UPDATE rsvps SET status = 'going' WHERE event_id = ? AND user_id IN (?)",
            [eventId, userIds],
            (err) => {
              if (err) {
                return done(err);
              }
              const message = `A seat opened up. You're now going to ${title}.`.slice(0, 255);
              db.query(
                'INSERT INTO notifications (user_id, message) VALUES ?',
                [userIds.map((id) => [id, message])],
                (err) => done(err),
              );
            },
          );
        },
      );
    },
  );
}

module.exports = { promoteWaitlist };
