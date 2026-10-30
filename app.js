const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./conn').promise();
db.config.dateStrings = true; // DATE columns come back as "YYYY-MM-DD" (views call .slice())
db.on('error', (err) => console.error('MySQL error (is MySQL running? run "npm run setup" if fourloop_db is missing):', err.message));
const { viewHelpers } = require('./utils');
const { wrap, loadUser } = require('./middleware');

const app = express();

// templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
Object.assign(app.locals, viewHelpers);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'omni-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

// re-read the signed-in user (and their role) from the DB before anything else runs
app.use(loadUser);

// values every page can use: current user, flash message, notifications
app.use(wrap(async (req, res, next) => {
  const u = req.session.user || null;
  res.locals.me = u;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.notes = [];
  res.locals.unread = 0;
  res.locals.badge = 0;
  if (u) {
    const [notes] = await db.query('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 8', [u.id]);
    const [[c]] = await db.query('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [u.id]);
    res.locals.notes = notes;
    res.locals.unread = c.c;
  }
  next();
}));

app.use('/', require('./routes/shared/auth'));
app.use('/', require('./routes/shared/profile'));
app.use('/student', require('./routes/student'));
app.use('/nonmember', require('./routes/nonmember'));
app.use('/admin', require('./routes/admin'));

app.post('/notifications/read', wrap(async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false });
  await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.user.id]);
  res.json({ ok: true });
}));

app.use((req, res) => res.status(404).send('Page not found. <a href="/">Go home</a>'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Check the server console. <a href="/">Go home</a>');
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`O.M.N.I running at http://localhost:${PORT}`);
});

/* Two instances on one port is the #1 way this app fails to boot. Say so plainly instead of
   throwing an unhandled EADDRINUSE stack trace (which also leaves nodemon sitting on a crash
   until a file changes). */
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') { console.error(err); return process.exit(1); }
  console.error([
    '',
    `  Port ${PORT} is already in use — another O.M.N.I instance is running.`,
    '  Find and stop it:',
    `    netstat -ano | findstr :${PORT}`,
    '    taskkill /PID <pid> /F',
    '  …or start this copy somewhere else:',
    `    PORT=3001 npm start`,
    ''
  ].join('\n'));
  process.exit(1);
});
