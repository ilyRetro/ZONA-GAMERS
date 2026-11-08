const express = require('express');
const db = require('../database/connection');
const { requireUser } = require('./auth');

const router = express.Router();

router.get('/perfil/editar', requireUser, (req, res) => {
  const user = db.prepare('SELECT id, username, email, avatar, bio, created_at FROM users WHERE id = ?')
    .get(req.session.user.id);
  res.render('edit-profile', { title: 'Editar perfil', user });
});

router.post('/perfil/editar', requireUser, (req, res) => {
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
  const avatar = typeof req.body.avatar === 'string' ? req.body.avatar.trim() : '';
  if (bio.length > 500) {
    return res.redirect('/perfil/editar?error=' + encodeURIComponent('La biografía no puede superar los 500 caracteres.'));
  }
  if (avatar.length > 500) {
    return res.redirect('/perfil/editar?error=' + encodeURIComponent('El enlace del avatar es demasiado largo.'));
  }
  if (avatar) {
    let parsedAvatar;
    try {
      parsedAvatar = new URL(avatar);
    } catch {
      return res.redirect('/perfil/editar?error=' + encodeURIComponent('Ingresa una URL válida para tu avatar.'));
    }
    if (parsedAvatar.protocol !== 'https:' || parsedAvatar.username || parsedAvatar.password) {
      return res.redirect('/perfil/editar?error=' + encodeURIComponent('El avatar debe usar una dirección HTTPS válida.'));
    }
  }

  db.prepare('UPDATE users SET bio = ?, avatar = ? WHERE id = ?')
    .run(bio, avatar || null, req.session.user.id);
  req.session.user.avatar = avatar || null;
  res.redirect(`/perfil/${encodeURIComponent(req.session.user.username)}?mensaje=` + encodeURIComponent('Perfil actualizado.'));
});

router.get('/perfil/:username', (req, res) => {
  const user = db.prepare(`
    SELECT id, username, avatar, bio, created_at FROM users
    WHERE username = ? COLLATE NOCASE
  `).get(req.params.username);
  if (!user) {
    return res.status(404).render('error', {
      title: 'Perfil no encontrado',
      statusCode: 404,
      message: 'No encontramos a este miembro.'
    });
  }
  const posts = db.prepare(`
    SELECT posts.*, categories.name AS category_name,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
    FROM posts
    LEFT JOIN categories ON categories.id = posts.category_id
    WHERE posts.user_id = ? ORDER BY posts.created_at DESC LIMIT 20
  `).all(user.id);
  const commentCount = db.prepare('SELECT COUNT(*) AS count FROM comments WHERE user_id = ?')
    .get(user.id).count;
  const postCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?')
    .get(user.id).count;
  res.render('profile', {
    title: `Perfil de ${user.username}`,
    profile: user,
    posts,
    postCount,
    commentCount,
    isOwnProfile: req.session.user?.id === user.id
  });
});

module.exports = router;
