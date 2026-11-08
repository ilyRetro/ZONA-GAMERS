const session = require('express-session');

class SQLiteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL,
        last_seen INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires);
    `);
    const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all().map((column) => column.name);
    if (!sessionColumns.includes('last_seen')) {
      db.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0');
    }
    this.getStatement = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.setStatement = db.prepare(`
      INSERT INTO sessions (sid, sess, expires, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        sess = excluded.sess,
        expires = excluded.expires,
        last_seen = excluded.last_seen
    `);
    this.touchStatement = db.prepare('UPDATE sessions SET expires = ?, last_seen = ? WHERE sid = ?');
    this.destroyStatement = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanupStatement = db.prepare('DELETE FROM sessions WHERE expires <= ?');
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + (sess.cookie?.maxAge || 86400000);
      this.setStatement.run(sid, JSON.stringify(sess), expires, Date.now());
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + (sess.cookie?.maxAge || 86400000);
      this.touchStatement.run(expires, Date.now(), sid);
      this.cleanupStatement.run(Date.now());
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.destroyStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = SQLiteStore;
