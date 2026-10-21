// Idempotent migration: add student information columns/keys to `users`.
const db = require('./conn').promise();

const statements = [
    'ALTER TABLE users ADD COLUMN student_id VARCHAR(24) NULL',
    'ALTER TABLE users ADD COLUMN contact VARCHAR(30) NULL',
    'ALTER TABLE users ADD COLUMN college VARCHAR(100) NULL',
    'ALTER TABLE users ADD COLUMN bio VARCHAR(300) NULL',
    'ALTER TABLE users ADD COLUMN profile_complete TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD UNIQUE KEY uq_student_id (student_id)',
];

(async () => {
    try {
        for (const sql of statements) {
            try {
                await db.query(sql);
                console.log('OK  : ' + sql);
            } catch (err) {
                if (err && (err.errno === 1060 || err.errno === 1061)) {
                    console.log('SKIP: ' + sql + ' (errno ' + err.errno + ')');
                    continue;
                }
                throw err;
            }
        }
        console.log('migration done');
        process.exit(0);
    } catch (err) {
        console.error('migration failed:', err);
        process.exit(1);
    }
})();
