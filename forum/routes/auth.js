const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../database/connection');

const router = express.Router();
const dummyPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', {
    title: 'Demasiados intentos',
    statusCode: 429,
    message: 'Se alcanzó el límite de intentos. Espera unos minutos antes de volver a intentarlo.'
  })
});

function requireGuest(req, res, next) {
  if (req.session.user) return res.redirect('/');
  next();
}

function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect('/login?error=Inicia%20sesión%20para%20continuar.');
  next();
}

function onlineCount() {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT sess FROM sessions WHERE expires > ? AND last_seen > ?
  `).all(now, now - 5 * 60 * 1000);
  const ids = new Set();
  for (const row of rows) {
    const activeSession = JSON.parse(row.sess);
    if (activeSession.user?.id) ids.add(activeSession.user.id);
  }
  return ids.size;
}

router.get('/', (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    posts: db.prepare('SELECT COUNT(*) AS count FROM posts').get().count,
    online: onlineCount()
  };
  const recentPosts = db.prepare(`
    SELECT posts.*, users.username, users.avatar, categories.name AS category_name,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN categories ON categories.id = posts.category_id
    ORDER BY posts.created_at DESC LIMIT 4
  `).all();
  const activity = db.prepare(`
    SELECT comments.content, comments.created_at, users.username, posts.id AS post_id, posts.title
    FROM comments
    JOIN users ON users.id = comments.user_id
    JOIN posts ON posts.id = comments.post_id
    ORDER BY comments.created_at DESC LIMIT 4
  `).all();
  res.render('home', { title: 'Inicio', stats, recentPosts, activity });
});

router.get('/registro', requireGuest, (req, res) => {
  res.render('register', { title: 'Crear cuenta' });
});

router.post('/registro', authLimiter, requireGuest, (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmation = typeof req.body.confirm_password === 'string' ? req.body.confirm_password : '';

  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) {
    return res.redirect('/registro?error=' + encodeURIComponent('El usuario debe tener entre 3 y 24 letras, números, guiones o guiones bajos.'));
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.redirect('/registro?error=' + encodeURIComponent('Ingresa un correo electrónico válido.'));
  }
  if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.redirect('/registro?error=' + encodeURIComponent('La contraseña debe tener entre 10 y 72 caracteres.'));
  }
  if (password !== confirmation) {
    return res.redirect('/registro?error=' + encodeURIComponent('Las contraseñas no coinciden.'));
  }
  if (req.body.accept_rules !== 'on') {
    return res.redirect('/registro?error=' + encodeURIComponent('Debes aceptar las normas de la comunidad.'));
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  try {
    db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
      .run(username, email, passwordHash);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.redirect('/registro?error=' + encodeURIComponent('Ese nombre de usuario o correo ya está registrado.'));
    }
    throw error;
  }
  res.redirect('/login?mensaje=' + encodeURIComponent('Tu cuenta está lista. Inicia sesión para participar.'));
});

router.get('/login', requireGuest, (req, res) => {
  res.render('login', { title: 'Iniciar sesión' });
});

router.post('/login', authLimiter, requireGuest, (req, res, next) => {
  const identity = typeof req.body.identity === 'string' ? req.body.identity.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare(`
    SELECT id, username, email, password, avatar
    FROM users
    WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE
  `).get(identity, identity);

  const passwordMatches = user
    ? bcrypt.compareSync(password, user.password)
    : bcrypt.compareSync(password, dummyPasswordHash);
  if (!user || !passwordMatches) {
    return res.redirect('/login?error=' + encodeURIComponent('Correo, usuario o contraseña incorrectos.'));
  }

  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.user = { id: user.id, username: user.username, email: user.email, avatar: user.avatar };
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.redirect('/?mensaje=' + encodeURIComponent(`¡Bienvenido, ${user.username}!`));
    });
  });
});

router.post('/logout', requireUser, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('zona.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });
    res.redirect('/?mensaje=' + encodeURIComponent('Has cerrado sesión.'));
  });
});

module.exports = router;
module.exports.requireUser = requireUser;
