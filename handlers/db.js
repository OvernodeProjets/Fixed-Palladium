const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = path.join(__dirname, '../storage/database.sqlite');
const db = new sqlite3.Database(dbFile);

// Enable WAL mode for better concurrency
db.run('PRAGMA journal_mode = WAL');
// Optimize write performance
db.run('PRAGMA synchronous = NORMAL');
// Create index for faster key lookups
db.run(`CREATE TABLE IF NOT EXISTS "keyv" ("key" VARCHAR(255) PRIMARY KEY, "value" TEXT)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_keyv_key ON keyv(key)`);

const stmtGet = db.prepare('SELECT value FROM keyv WHERE key = ?');
const stmtSet = db.prepare('INSERT OR REPLACE INTO keyv (key, value) VALUES (?, ?)');
const stmtDelete = db.prepare('DELETE FROM keyv WHERE key = ?');

const dbWrapper = {
  get(key) {
    return new Promise((resolve) => {
      const prefixedKey = `keyv:${key}`;
      stmtGet.get(prefixedKey, (err, row) => {
        if (err) {
          console.error('Error in db.get:', err);
          resolve(undefined);
          return;
        }
        try {
          resolve(row ? JSON.parse(row.value).value : undefined);
        } catch {
          resolve(undefined);
        }
      });
    });
  },

  set(key, value) {
    return new Promise((resolve) => {
      const prefixedKey = `keyv:${key}`;
      const serializedValue = JSON.stringify({
        value: value,
        expires: null
      });

      stmtSet.run(prefixedKey, serializedValue, (err) => {
        resolve(!err);
      });
    });
  },

  delete(key) {
    return new Promise((resolve) => {
      const prefixedKey = `keyv:${key}`;
      stmtDelete.run(prefixedKey, (err) => {
        resolve(!err);
      });
    });
  },
};

process.on('exit', () => {
  stmtGet.finalize();
  stmtSet.finalize();
  stmtDelete.finalize();
  db.close();
});

module.exports = dbWrapper;
