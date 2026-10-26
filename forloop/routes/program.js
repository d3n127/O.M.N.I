/* Event program: the running order (time, segment, speaker) shown on each event. */
const db = require('../conn');
const { text } = require('../utils');

const MAX_ITEMS = 30;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/*
 * Turn the admin's textarea into program rows. One line per segment:
 *   09:30 | Opening keynote | Dana Reyes     (the time and speaker are optional)
 * Returns [{ start, title, speaker }] in the order written.
 */
function parseProgram(raw) {
  const items = [];

  String(raw || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const parts = line.split('|').map((part) => part.trim());
      const match = TIME_PATTERN.exec(parts[0]);
      let start = null;

      if (match) {
        /* A malformed time such as 25:00 is dropped rather than shown as a title */
        if (Number(match[1]) < 24 && Number(match[2]) < 60) {
          start = `${match[1].padStart(2, '0')}:${match[2]}:00`;
        }
        parts.shift();
      }
      const title = text(parts[0], 140);
      if (title && items.length < MAX_ITEMS) {
        items.push({ start, title, speaker: text(parts[1], 100) || null });
      }
    });

  return items;
}

/* The reverse of parseProgram, used to fill the admin form. */
function programToText(items) {
  return items
    .map((i) => [i.start_time ? i.start_time.slice(0, 5) : '', i.title, i.speaker || ''])
    .map(([time, title, speaker]) => [time, title, speaker].filter((p, n) => p || n === 1).join(' | '))
    .join('\n');
}

/* Replace an event's whole program. done(err) */
function saveProgram(eventId, items, done) {
  db.query('DELETE FROM event_program WHERE event_id = ?', [eventId], (err) => {
    if (err || !items.length) {
      return done(err);
    }
    const rows = items.map((i, position) => [eventId, position, i.start, i.title, i.speaker]);
    db.query(
      'INSERT INTO event_program (event_id, position, start_time, title, speaker) VALUES ?',
      [rows],
      (err) => done(err),
    );
  });
}

/* Give every event `program` (ordered rows) and `speakers` (unique names). done(err) */
function attachProgram(events, done) {
  events.forEach((e) => {
    e.program = [];
    e.speakers = [];
  });
  if (!events.length) {
    return done(null);
  }

  db.query(
    'SELECT * FROM event_program WHERE event_id IN (?) ORDER BY event_id, position, id',
    [events.map((e) => e.id)],
    (err, rows) => {
      if (err) {
        return done(err);
      }
      rows.forEach((row) => {
        const event = events.find((e) => e.id === row.event_id);
        event.program.push(row);
        if (row.speaker && !event.speakers.includes(row.speaker)) {
          event.speakers.push(row.speaker);
        }
      });
      done(null);
    },
  );
}

module.exports = { parseProgram, programToText, saveProgram, attachProgram };
