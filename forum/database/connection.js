
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { uploadsDirectory } = require('../services/media');

const db = new Database(
  process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, 'zona-gamers.db')
);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    bio TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '◈'
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (post_id IS NOT NULL OR comment_id IS NULL)
  );
`);

const postColumns = db.prepare('PRAGMA table_info(posts)').all().map((column) => column.name);
if (!postColumns.includes('category_id')) {
  db.exec('ALTER TABLE posts ADD COLUMN category_id INTEGER REFERENCES categories(id)');
}
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!userColumns.includes('username_changed_at')) {
  db.exec('ALTER TABLE users ADD COLUMN username_changed_at DATETIME');
}
const commentColumns = db.prepare('PRAGMA table_info(comments)').all().map((column) => column.name);
if (!commentColumns.includes('submission_key')) {
  db.exec('ALTER TABLE comments ADD COLUMN submission_key TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS role_change_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    target_user_id INTEGER NOT NULL,
    previous_role TEXT NOT NULL,
    new_role TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS role_change_audit_target_idx
    ON role_change_audit(target_user_id, created_at);
  CREATE TABLE IF NOT EXISTS email_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('awaiting_email_provider', 'verified', 'cancelled')),
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS email_change_requests_pending_user_idx
    ON email_change_requests(user_id) WHERE status = 'awaiting_email_provider';
`);

const grantInitialAdmin = db.transaction(() => {
  const account = db.prepare(`
    SELECT id, role FROM users
    WHERE username = ? COLLATE NOCASE
  `).get('RETROCESO');
  if (!account || String(account.role).toLowerCase() === 'ceo'
      || String(account.role).toLowerCase() === 'admin') return;

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', account.id);
  db.prepare(`
    INSERT INTO role_change_audit
      (actor_user_id, target_user_id, previous_role, new_role, reason)
    VALUES (NULL, ?, ?, 'admin', 'Initial owner role migration')
  `).run(account.id, account.role || 'user');
});
grantInitialAdmin();

const seedCategories = db.prepare(`
  INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)
`);
[
  ['American Truck Simulator', 'Rutas, consejos y experiencias por las carreteras de Estados Unidos.', '🚛'],
  ['Euro Truck Simulator 2', 'Comparte tus viajes y novedades por Europa.', '🌍'],
  ['Mods y modificaciones', 'Mods, mapas, cargas y personalización de tus simuladores.', '🧰'],
  ['Camiones y configuraciones', 'Configuraciones, pinturas y mecánicas para tu próximo viaje.', '⚙'],
  ['Convoyes y multijugador', 'Organiza convoyes y encuentra compañeros de ruta.', '🛣'],
  ['Soporte técnico', 'Ayuda con instalaciones, rendimiento y errores del juego.', '🔧'],
  ['Noticias y anuncios', 'Novedades y comunicados de la comunidad.', '📡'],
  ['Comunidad y conversaciones generales', 'Preséntate y conversa sobre gaming y simulación.', '💬'],
  ['FiveM', 'Roleplay, servidores y experiencias de FiveM.', '◈'],
  ['DayZ', 'Supervivencia, servidores y experiencias de DayZ.', '◈'],
  ['Arma Reforger', 'Operaciones, mods y multijugador de Arma Reforger.', '◈']
].forEach((category) => seedCategories.run(...category));

db.prepare(`
  UPDATE posts SET category_id = (SELECT id FROM categories WHERE name = 'American Truck Simulator')
  WHERE category_id IS NULL
`).run();

const legacyMediaPattern = /\/uploads\/([a-f\d-]{36}\.(?:jpg|png|webp|gif|mp4|webm))/gi;
const mimeTypesByExtension = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm'
};
const postsWithMedia = db.prepare('SELECT id, user_id, content FROM posts').all();
const insertLegacyAttachment = db.prepare(`
  INSERT OR IGNORE INTO attachments (user_id, post_id, path, mime_type)
  VALUES (?, ?, ?, ?)
`);
const migrateLegacyAttachments = db.transaction(() => {
  for (const post of postsWithMedia) {
    legacyMediaPattern.lastIndex = 0;
    for (const [, filename] of post.content.matchAll(legacyMediaPattern)) {
      if (!fs.existsSync(path.join(uploadsDirectory, filename))) continue;
      const extension = path.extname(filename).slice(1).toLowerCase();
      insertLegacyAttachment.run(
        post.user_id,
        post.id,
        `/uploads/${filename}`,
        mimeTypesByExtension[extension]
      );
    }
  }
});
migrateLegacyAttachments();

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_idx ON users(username COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_nocase_idx ON users(email COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS posts_category_created_idx ON posts(category_id, created_at);
  CREATE INDEX IF NOT EXISTS comments_post_created_idx ON comments(post_id, created_at);
  CREATE INDEX IF NOT EXISTS attachments_post_created_idx ON attachments(post_id, created_at);
  CREATE INDEX IF NOT EXISTS attachments_comment_created_idx ON attachments(comment_id, created_at);
  CREATE INDEX IF NOT EXISTS attachments_user_staged_idx ON attachments(user_id, post_id, created_at);
  CREATE INDEX IF NOT EXISTS users_username_changed_idx ON users(username_changed_at);
  CREATE UNIQUE INDEX IF NOT EXISTS comments_submission_key_idx
    ON comments(user_id, submission_key) WHERE submission_key IS NOT NULL;
`);

console.log('Base de datos ZONA GAMERS conectada correctamente.');

module.exports = db;
