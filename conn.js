const mysql = require('mysql2')
const connection = mysql.createConnection({
    user: "root",
    host: "localhost",
    password: "",
    database: "fourloop_db"
});

module.exports = connection;

