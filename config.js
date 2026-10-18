// Edit these values (or set environment variables) to match your MySQL / XAMPP setup.
module.exports = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '@Osano123',
  database: process.env.DB_NAME || 'fourloop_db',
  port: Number(process.env.PORT) || 3000
};
