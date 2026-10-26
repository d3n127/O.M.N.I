/* "Add to calendar": builds .ics files that Google, Apple and Outlook calendars can import. */
const { attachProgram } = require('./program');
const { fmtTime } = require('../utils');

const pad = (n) => String(n).padStart(2, '0');

/* "2026-10-28" + "09:00:00" -> "20261028T090000" (floating local time) */
function stamp(date, time) {
  return `${String(date).slice(0, 10).replace(/-/g, '')}T${String(time).slice(0, 8).replace(/:/g, '').padEnd(6, '0')}`;
}

/* Events have no end time, so the calendar entry lasts one hour. */
function endStamp(date, time) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const [h, min, s] = String(time).split(':').map(Number);
  const end = new Date(y, m - 1, d, h + 1, min, s || 0);
  return `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}${pad(end.getSeconds())}`;
}

const escapeText = (value) =>
  String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/* Lines longer than 75 characters continue on the next line, starting with a space. */
function fold(line) {
  const parts = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

function describe(e) {
  const lines = [];
  if (e.description) {
    lines.push(e.description);
  }
  if (e.program.length) {
    lines.push('', 'Program:');
    e.program.forEach((p) => {
      const time = p.start_time ? `${fmtTime(p.start_time)} - ` : '';
      lines.push(`${time}${p.title}${p.speaker ? ` (${p.speaker})` : ''}`);
    });
  }
  return lines.join('\n');
}

/* Calendar text for events that have org_name; loads each event's program first. done(err, text) */
function buildCalendar(events, done) {
  attachProgram(events, (err) => {
    if (err) {
      return done(err);
    }
    const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//O.M.N.I//Events//EN', 'CALSCALE:GREGORIAN'];

    events.forEach((e) => {
      lines.push(
        'BEGIN:VEVENT',
        `UID:event-${e.id}@omni.local`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(e.event_date, e.event_time)}`,
        `DTEND:${endStamp(e.event_date, e.event_time)}`,
        `SUMMARY:${escapeText(`${e.title} (${e.org_name})`)}`,
        `LOCATION:${escapeText(e.location)}`,
        `DESCRIPTION:${escapeText(describe(e))}`,
        'END:VEVENT',
      );
    });
    lines.push('END:VCALENDAR');
    done(null, lines.map(fold).join('\r\n') + '\r\n');
  });
}

module.exports = { buildCalendar };
