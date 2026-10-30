const mysql = require('mysql2')
const connection = mysql.createConnection({
    user: "root",
    host: "localhost",
    password: "@Osano123",
    database: "fourloop_db"
});

module.exports = connection;

