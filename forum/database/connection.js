
const Database = require('better-sqlite3');
const path = require('path');

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
`);

const postColumns = db.prepare('PRAGMA table_info(posts)').all().map((column) => column.name);
if (!postColumns.includes('category_id')) {
  db.exec('ALTER TABLE posts ADD COLUMN category_id INTEGER REFERENCES categories(id)');
}

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
  ['Comunidad y conversaciones generales', 'Preséntate y conversa sobre gaming y simulación.', '💬']
].forEach((category) => seedCategories.run(...category));

db.prepare(`
  UPDATE posts SET category_id = (SELECT id FROM categories WHERE name = 'American Truck Simulator')
  WHERE category_id IS NULL
`).run();

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_idx ON users(username COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_nocase_idx ON users(email COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS posts_category_created_idx ON posts(category_id, created_at);
  CREATE INDEX IF NOT EXISTS comments_post_created_idx ON comments(post_id, created_at);
`);

console.log('Base de datos ZONA GAMERS conectada correctamente.');

module.exports = db;
