/* O.M.N.I - Express app: sessions, per-request user loading, and route mounting. */
const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./conn').promise();
const { viewHelpers, wrap } = require('./utils');
const { sessionUser } = require('./routes/auth');

db.config.dateStrings = true; // DATE columns come back as "YYYY-MM-DD" strings
db.on('error', logDatabaseError);

const app = express();

/* ---------- Middleware and route handlers ---------- */

function logDatabaseError(err) {
  console.error(
    'MySQL error (is MySQL running? run "npm run setup" if fourloop_db is missing):',
    err.message,
  );
}

/* Re-read the user from the DB on every request, so role changes and deleted accounts apply at once. */
async function loadUser(req, res, next) {
  const saved = req.session.user;
  if (!saved) {
    return next();
  }

  const [[row]] = await db.query('SELECT id, full_name, role, org_id FROM users WHERE id = ?', [
    saved.id,
  ]);
  if (!row) {
    return req.session.destroy(() => next());
  }
  req.session.user = sessionUser(row);
  next();
}

/* Values every page can use: me, flash message, notifications. */
async function loadPageValues(req, res, next) {
  const user = req.session.user || null;
  res.locals.me = user;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  res.locals.notes = [];
  res.locals.unread = 0;
  res.locals.badge = 0;

  if (user) {
    const [notes] = await db.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 8',
      [user.id],
    );
    const [[unread]] = await db.query(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0',
      [user.id],
    );
    res.locals.notes = notes;
    res.locals.unread = unread.c;
  }
  next();
}

async function markNotificationsRead(req, res) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false });
  }
  await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.user.id]);
  res.json({ ok: true });
}

function showNotFound(req, res) {
  res.status(404).send('Page not found. <a href="/">Go home</a>');
}

/* Express recognises an error handler by its four parameters. */
function showServerError(err, req, res, next) {
  console.error(err);
  res.status(500).send('Something went wrong. Check the server console. <a href="/">Go home</a>');
}

/* ---------- Setup ---------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
Object.assign(app.locals, viewHelpers);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'omni-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  }),
);

app.use(wrap(loadUser));
app.use(wrap(loadPageValues));

/* ---------- Routes ---------- */
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/profile'));
app.use('/student', require('./routes/student'));
app.use('/nonmember', require('./routes/nonmember'));
app.use('/admin', require('./routes/admin'));
app.post('/notifications/read', wrap(markNotificationsRead));

app.use(showNotFound);
app.use(showServerError);

/* ---------- Start ---------- */
const PORT = process.env.PORT || 3000;

function announceStart() {
  console.log(`O.M.N.I running at http://localhost:${PORT}`);
}

/* Print a clear message when the port is already in use. */
function handleServerError(err) {
  if (err.code !== 'EADDRINUSE') {
    console.error(err);
    return process.exit(1);
  }
  console.error(
    [
      '',
      `  Port ${PORT} is already in use — another O.M.N.I instance is running.`,
      '  Find and stop it:',
      `    netstat -ano | findstr :${PORT}`,
      '    taskkill /PID <pid> /F',
      '  …or start this copy somewhere else:',
      `    PORT=3001 npm start`,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

app.listen(PORT, announceStart).on('error', handleServerError);
