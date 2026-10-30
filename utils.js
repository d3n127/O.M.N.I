const { randomBytes, scrypt, timingSafeEqual } = require('crypto');

/* ---------- passwords ----------
   A password is never stored. We store a random salt plus a deliberately SLOW hash:
     1. salt   - fresh random bytes per password, so identical passwords hash differently
                 and no precomputed table (rainbow table) can be reused across accounts.
     2. scrypt - the hash itself. It is memory-hard on purpose: each guess costs real
                 time + RAM, so an attacker cannot try billions of passwords a second.
                 It is one-way, not encryption - you cannot reverse it, only redo it.
     3. verify - pull the salt back out, run scrypt again on what was typed, compare.
     4. timingSafeEqual - compares in constant time so response time never reveals
                 how many characters matched.
   Format stays "salt:hexkey" so rows written by older code still verify as-is. */
const KEYLEN = 64;
const derive = (pw, salt) => new Promise((resolve, reject) =>
  scrypt(String(pw), salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(pw, salt)).toString('hex')}`;
}

async function verifyPassword(pw, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const test = await derive(pw, salt);
  const saved = Buffer.from(key, 'hex');
  return saved.length === test.length && timingSafeEqual(saved, test);
}

/* ---------- date helpers ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p = (s) => String(s).slice(0, 10).split('-').map(Number);
const fmtShort = (s) => { const [, m, d] = p(s); return `${MON[m - 1]} ${String(d).padStart(2, '0')}`; };
const fmtDay = (s) => p(s)[2];
const fmtMon = (s) => MON[p(s)[1] - 1];
const fmtLong = (s) => { const [, m, d] = p(s); return `${MONL[m - 1]} ${d}`; };
const fmtMonthYear = (s) => { const [y, m] = p(s); return `${MON[m - 1]} ${y}`; };
const fmtTime = (t) => {
  let [h, m] = String(t).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/* ---------- departments: full name + abbreviation (shared by profile, settings, admin) ---------- */
const DEPARTMENTS = [
  { name: 'College of Information Technology', abbr: 'CITE' },
  { name: 'College of Engineering', abbr: 'COE' },
  { name: 'College of Business & Accountancy', abbr: 'CBA' },
  { name: 'College of Nursing & Health Sciences', abbr: 'CNHS' },
  { name: 'College of Arts & Sciences', abbr: 'CAS' },
  { name: 'College of Education', abbr: 'COED' }
];
const DEPT_NAMES = DEPARTMENTS.map((d) => d.name);
const deptAbbr = (name) => { const d = DEPARTMENTS.find((x) => x.name === name); return d ? d.abbr : String(name || ''); };

/* ---------- inline SVG icons ---------- */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01"/>',
  userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  building: '<path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M14 9h5a1 1 0 0 1 1 1v11M3 21h18M8 7h2M8 11h2M8 15h2"/>',
  chart: '<path d="M4 4v16h16M9 17v-5M14 17V8M19 17v-8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
};
const icon = (name, size = 20, cls = '') =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const viewHelpers = { icon, initials, fmtShort, fmtDay, fmtMon, fmtLong, fmtMonthYear, fmtTime, deptAbbr };

module.exports = { hashPassword, verifyPassword, ymd, MON, DEPARTMENTS, DEPT_NAMES, ...viewHelpers, viewHelpers };
