const mysql = require('mysql2');
const cfg = require('./config');

const pool = mysql.createPool({
  host: cfg.host,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true 
});

module.exports = pool.promise();
