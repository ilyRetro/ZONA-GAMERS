const express = require('express');
const db = require('../database/connection');
const { requireUser } = require('./auth');

const router = express.Router();

router.get('/foros', (req, res) => {
  const categories = db.prepare(`
    SELECT categories.*,
      COUNT(DISTINCT posts.id) AS post_count,
      COUNT(comments.id) AS comment_count,
      (SELECT MAX(activity.created_at) FROM (
        SELECT posts.created_at FROM posts WHERE posts.category_id = categories.id
        UNION ALL
        SELECT comments.created_at FROM comments
        JOIN posts ON posts.id = comments.post_id
        WHERE posts.category_id = categories.id
      ) AS activity) AS last_activity
    FROM categories
    LEFT JOIN posts ON posts.category_id = categories.id
    LEFT JOIN comments ON comments.post_id = posts.id
    GROUP BY categories.id
    ORDER BY categories.id
  `).all();
  const selectedCategory = Number.parseInt(req.query.categoria, 10);
  const posts = db.prepare(`
    SELECT posts.*, users.username, users.avatar, categories.name AS category_name,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN categories ON categories.id = posts.category_id
    WHERE (? IS NULL OR posts.category_id = ?)
    ORDER BY posts.created_at DESC LIMIT 30
  `).all(Number.isInteger(selectedCategory) && selectedCategory > 0 ? selectedCategory : null,
    Number.isInteger(selectedCategory) && selectedCategory > 0 ? selectedCategory : null);
  res.render('forums', {
    title: 'Foros',
    categories,
    posts,
    selectedCategory: Number.isInteger(selectedCategory) ? selectedCategory : null
  });
});

router.get('/comunidad', (req, res) => {
  const members = db.prepare(`
    SELECT users.id, users.username, users.avatar, users.bio, users.created_at,
      COUNT(posts.id) AS post_count
    FROM users
    LEFT JOIN posts ON posts.user_id = users.id
    GROUP BY users.id
    ORDER BY users.created_at DESC LIMIT 12
  `).all();
  const recentPosts = db.prepare(`
    SELECT posts.id, posts.title, posts.created_at, users.username, users.avatar,
      categories.name AS category_name
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN categories ON categories.id = posts.category_id
    ORDER BY posts.created_at DESC LIMIT 5
  `).all();
  res.render('community', { title: 'Comunidad', members, recentPosts });
});

router.get('/publicaciones/nueva', requireUser, (req, res) => {
  const categories = db.prepare('SELECT id, name FROM categories ORDER BY id').all();
  res.render('new-post', { title: 'Nueva publicación', categories });
});

router.post('/publicaciones', requireUser, (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const categoryId = Number.parseInt(req.body.category_id, 10);
  const category = Number.isSafeInteger(categoryId) && categoryId > 0
    ? db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
    : null;
  if (title.length < 5 || title.length > 120 || content.length < 10 || content.length > 10000 || !category) {
    return res.redirect('/publicaciones/nueva?error=' + encodeURIComponent('Revisa el título, el contenido y la categoría. El título debe tener 5–120 caracteres y el contenido 10–10.000.'));
  }
  const result = db.prepare(`
    INSERT INTO posts (user_id, category_id, title, content) VALUES (?, ?, ?, ?)
  `).run(req.session.user.id, categoryId, title, content);
  res.redirect(`/publicaciones/${result.lastInsertRowid}?mensaje=` + encodeURIComponent('Publicación creada.'));
});

router.get('/publicaciones/:id', (req, res) => {
  const postId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(postId) || postId < 1) {
    return res.status(404).render('error', {
      title: 'Publicación no encontrada',
      statusCode: 404,
      message: 'Esta publicación no existe o fue eliminada.'
    });
  }
  const post = db.prepare(`
    SELECT posts.*, users.username, users.avatar, categories.name AS category_name
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN categories ON categories.id = posts.category_id
    WHERE posts.id = ?
  `).get(postId);
  if (!post) {
    return res.status(404).render('error', {
      title: 'Publicación no encontrada',
      statusCode: 404,
      message: 'Esta publicación no existe o fue eliminada.'
    });
  }
  const comments = db.prepare(`
    SELECT comments.*, users.username, users.avatar
    FROM comments
    JOIN users ON users.id = comments.user_id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at
  `).all(postId);
  res.render('post', { title: post.title, post, comments });
});

router.post('/publicaciones/:id/comentarios', requireUser, (req, res) => {
  const postId = Number.parseInt(req.params.id, 10);
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!Number.isSafeInteger(postId) || postId < 1) {
    return res.status(404).render('error', {
      title: 'Publicación no encontrada',
      statusCode: 404,
      message: 'No se pudo encontrar la publicación para comentar.'
    });
  }
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    return res.status(404).render('error', {
      title: 'Publicación no encontrada',
      statusCode: 404,
      message: 'No se pudo encontrar la publicación para comentar.'
    });
  }
  if (content.length < 2 || content.length > 2000) {
    return res.redirect(`/publicaciones/${postId}?error=` + encodeURIComponent('El comentario debe tener entre 2 y 2.000 caracteres.'));
  }
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(postId, req.session.user.id, content);
  res.redirect(`/publicaciones/${postId}#comentarios`);
});

module.exports = router;
