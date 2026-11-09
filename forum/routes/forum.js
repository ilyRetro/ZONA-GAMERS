const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../database/connection');
const { requireUser } = require('./auth');
const { games } = require('../services/games');
const { sanitizeRichContent, isValidRichContent, richContentToText } = require('../services/rich-content');
const { removeMedia, saveMedia } = require('../services/media');
const { getOnlineMembers } = require('../services/online-members');
const { requireRole } = require('../services/roles');

const router = express.Router();
const gamesBySlug = new Map(games.map((game) => [game.slug, game]));
const acceptedMedia = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'
]);
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, callback) => {
    if (!acceptedMedia.has(file.mimetype)) {
      req.mediaUploadValidationError = 'Elige una imagen JPG, PNG, WebP o GIF, o un video MP4 o WebM.';
      return callback(null, false);
    }
    callback(null, true);
  }
}).array('media', 5);

function mediaPathsIn(content) {
  const paths = new Set();
  const pattern = /src="(\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp|gif|mp4|webm))"/gi;
  for (const [, mediaPath] of content.matchAll(pattern)) paths.add(mediaPath);
  return [...paths];
}

function submittedMediaPaths(req, content) {
  const paths = new Set(mediaPathsIn(content));
  if (req.body.attachments === undefined) return [...paths];
  if (typeof req.body.attachments !== 'string' || req.body.attachments.length > 2000) return null;
  let submitted;
  try {
    submitted = JSON.parse(req.body.attachments);
  } catch {
    return null;
  }
  if (!Array.isArray(submitted) || submitted.length > 5
      || submitted.some((item) => typeof item !== 'string'
        || !/^\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp|gif|mp4|webm)$/i.test(item))) {
    return null;
  }
  submitted.forEach((item) => paths.add(item));
  return paths.size <= 5 ? [...paths] : null;
}

function validationError(req, res, status, message, redirectUrl) {
  if (req.get('accept')?.includes('application/json')) {
    return res.status(status).json({ error: message });
  }
  return res.redirect(`${redirectUrl}${redirectUrl.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
}

function sendSuccess(req, res, status, message, redirect) {
  if (req.get('accept')?.includes('application/json')) {
    return res.status(status).json({ message, redirect });
  }
  return res.redirect(redirect);
}

function findStagedMedia(paths, userId) {
  if (!paths.length) return [];
  const placeholders = paths.map(() => '?').join(', ');
  return db.prepare(`
    SELECT id, path
    FROM attachments
    WHERE user_id = ? AND post_id IS NULL AND comment_id IS NULL
      AND path IN (${placeholders})
  `).all(userId, ...paths);
}

function attachMediaToPost(media, postId, userId) {
  const attach = db.prepare(`
    UPDATE attachments
    SET post_id = ?
    WHERE id = ? AND user_id = ? AND post_id IS NULL AND comment_id IS NULL
  `);
  for (const item of media) {
    if (attach.run(postId, item.id, userId).changes !== 1) {
      throw new Error('An uploaded attachment could not be associated with its post.');
    }
  }
}

function findGameCategory(game) {
  return db.prepare('SELECT id, name FROM categories WHERE name = ?').get(game.categoryName);
}

function notFound(res, message) {
  return res.status(404).render('error', {
    title: 'Página no encontrada',
    statusCode: 404,
    message
  });
}

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
    SELECT posts.*, users.username, users.avatar, users.role, categories.name AS category_name,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count,
      (SELECT path FROM attachments WHERE attachments.post_id = posts.id
        AND attachments.comment_id IS NULL AND attachments.mime_type LIKE 'image/%'
        ORDER BY attachments.id LIMIT 1) AS preview_image,
      (SELECT COUNT(*) FROM attachments WHERE attachments.post_id = posts.id
        AND attachments.comment_id IS NULL) AS attachment_count
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
    selectedCategory: Number.isInteger(selectedCategory) ? selectedCategory : null,
    onlineMembers: getOnlineMembers(db)
  });
});

router.get('/api/miembros-en-linea', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ members: getOnlineMembers(db) });
});

router.get('/comunidad', (req, res) => {
  const members = db.prepare(`
    SELECT users.id, users.username, users.avatar, users.bio, users.role, users.created_at,
      COUNT(posts.id) AS post_count
    FROM users
    LEFT JOIN posts ON posts.user_id = users.id
    GROUP BY users.id
    ORDER BY users.created_at DESC LIMIT 12
  `).all();
  const recentPosts = db.prepare(`
    SELECT posts.id, posts.title, posts.created_at, users.username, users.avatar, users.role,
      categories.name AS category_name
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN categories ON categories.id = posts.category_id
    ORDER BY posts.created_at DESC LIMIT 5
  `).all();
  res.render('community', { title: 'Comunidad', members, recentPosts });
});

router.get('/juegos/:slug', (req, res) => {
  const game = gamesBySlug.get(req.params.slug);
  if (!game) return notFound(res, 'No encontramos el foro de ese juego.');

  const category = findGameCategory(game);
  if (!category) throw new Error(`Missing forum category for ${game.slug}.`);
  const posts = db.prepare(`
    SELECT posts.*, users.username, users.avatar, users.role, categories.name AS category_name,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count,
      (SELECT path FROM attachments WHERE attachments.post_id = posts.id
        AND attachments.comment_id IS NULL AND attachments.mime_type LIKE 'image/%'
        ORDER BY attachments.id LIMIT 1) AS preview_image,
      (SELECT COUNT(*) FROM attachments WHERE attachments.post_id = posts.id
        AND attachments.comment_id IS NULL) AS attachment_count
    FROM posts
    JOIN users ON users.id = posts.user_id
    JOIN categories ON categories.id = posts.category_id
    WHERE posts.category_id = ?
    ORDER BY posts.created_at DESC LIMIT 30
  `).all(category.id);

  res.render('game-forum', {
    title: game.name,
    game,
    posts,
    onlineMembers: getOnlineMembers(db)
  });
});

router.get('/publicaciones/nueva', requireUser, (req, res) => {
  const gameSlug = req.query.juego;
  let game = null;
  let categories;
  if (gameSlug !== undefined) {
    game = typeof gameSlug === 'string' ? gamesBySlug.get(gameSlug) : null;
    if (!game) return notFound(res, 'No encontramos el foro de ese juego.');
    const category = findGameCategory(game);
    if (!category) throw new Error(`Missing forum category for ${game.slug}.`);
    categories = [category];
  } else {
    categories = db.prepare('SELECT id, name FROM categories ORDER BY id').all();
  }
  res.render('new-post', { title: 'Nueva publicación', categories, game });
});

router.post('/publicaciones/medios', requireUser, (req, res, next) => {
  mediaUpload(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        const statusCode = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(statusCode).json({
          error: statusCode === 413
            ? 'Cada archivo debe pesar como máximo 10 MB.'
            : 'Adjunta como máximo 5 archivos en cada carga.'
        });
      }
      return next(uploadError);
    }
    if (req.mediaUploadValidationError) {
      return res.status(400).json({ error: req.mediaUploadValidationError });
    }
    if (!req.files?.length) {
      return res.status(400).json({ error: 'Selecciona al menos un archivo para adjuntar.' });
    }
    const savedMedia = [];
    try {
      for (const file of req.files) {
        savedMedia.push(await saveMedia(file));
      }
      const insertAttachments = db.transaction(() => {
        const insert = db.prepare(`
          INSERT INTO attachments (user_id, path, mime_type)
          VALUES (?, ?, ?)
        `);
        for (const media of savedMedia) {
          insert.run(req.session.user.id, media.url, media.mime);
        }
      });
      insertAttachments();
      res.status(201).json({
        media: savedMedia.map(({ url, mime, kind }) => ({ url, mime, kind }))
      });
    } catch (error) {
      for (const media of savedMedia) {
        try {
          await removeMedia(media.filename);
        } catch (cleanupError) {
          console.error('Unable to remove unregistered media file %s:\n%s', media.filename, cleanupError.stack || cleanupError);
        }
      }
      if (error.status === 400) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });
});

router.post('/publicaciones/medios/eliminar', requireUser, async (req, res, next) => {
  const mediaPath = typeof req.body.path === 'string' ? req.body.path : '';
  if (!/^\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp|gif|mp4|webm)$/i.test(mediaPath)) {
    return res.status(400).json({ error: 'El archivo adjunto no es válido.' });
  }
  const staged = db.prepare(`
    SELECT id, path FROM attachments
    WHERE user_id = ? AND path = ? AND post_id IS NULL AND comment_id IS NULL
  `).get(req.session.user.id, mediaPath);
  if (!staged) return res.status(404).json({ error: 'El archivo ya no está disponible en esta sesión.' });
  try {
    await removeMedia(path.basename(staged.path));
    db.prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?').run(staged.id, req.session.user.id);
    res.json({ message: 'Archivo eliminado.' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      db.prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?').run(staged.id, req.session.user.id);
      return res.json({ message: 'Archivo eliminado.' });
    }
    next(error);
  }
});

router.post('/publicaciones', requireUser, (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const submittedContent = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const content = sanitizeRichContent(submittedContent);
  const textContent = richContentToText(content);
  const game = req.body.game === undefined
    ? null
    : typeof req.body.game === 'string' ? gamesBySlug.get(req.body.game) : null;
  if (req.body.game !== undefined && !game) {
    return notFound(res, 'No encontramos el foro de ese juego.');
  }
  const categoryId = game
    ? findGameCategory(game)?.id
    : Number.parseInt(req.body.category_id, 10);
  const category = Number.isSafeInteger(categoryId) && categoryId > 0
    ? db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
    : null;
  const formUrl = game
    ? `/publicaciones/nueva?juego=${encodeURIComponent(game.slug)}`
    : '/publicaciones/nueva';
  const mediaPaths = submittedMediaPaths(req, content);
  if (!mediaPaths) {
    return validationError(req, res, 400, 'La lista de adjuntos no es válida.', formUrl);
  }
  const validContent = isValidRichContent(submittedContent, 100000, 10);
  if (title.length < 5 || title.length > 120
      || submittedContent.length > 100000 || textContent.length > 10000
      || (!validContent && mediaPaths.length === 0) || !category) {
    return validationError(req, res, 422,
      'Revisa el título, el contenido y la categoría. El título debe tener 5–120 caracteres y el contenido 10–10.000.',
      formUrl);
  }
  const stagedMedia = findStagedMedia(mediaPaths, req.session.user.id);
  if (stagedMedia.length !== mediaPaths.length) {
    return validationError(req, res, 422,
      'Vuelve a adjuntar cualquier archivo que no pertenezca a tu sesión.', formUrl);
  }
  const createPost = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO posts (user_id, category_id, title, content) VALUES (?, ?, ?, ?)
    `).run(req.session.user.id, categoryId, title, content);
    attachMediaToPost(stagedMedia, result.lastInsertRowid, req.session.user.id);
    return result;
  });
  const result = createPost();
  return sendSuccess(req, res, 201, 'Publicación creada.',
    `/publicaciones/${result.lastInsertRowid}?mensaje=${encodeURIComponent('Publicación creada.')}`);
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
    SELECT posts.*, users.username, users.avatar, users.role, categories.name AS category_name
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
    SELECT comments.*, users.username, users.avatar, users.role,
      (SELECT COUNT(*) FROM attachments
        WHERE attachments.comment_id = comments.id) AS attachment_count
    FROM comments
    JOIN users ON users.id = comments.user_id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at
  `).all(postId);
  const inlinePostMedia = new Set(mediaPathsIn(post.content));
  post.attachments = db.prepare(`
    SELECT path, mime_type FROM attachments
    WHERE post_id = ? AND comment_id IS NULL
    ORDER BY id
  `).all(postId).filter((attachment) => !inlinePostMedia.has(attachment.path));
  comments.forEach((comment) => {
    const inlineCommentMedia = new Set(mediaPathsIn(comment.content));
    comment.attachments = db.prepare(`
      SELECT path, mime_type FROM attachments
      WHERE comment_id = ?
      ORDER BY id
    `).all(comment.id).filter((attachment) => !inlineCommentMedia.has(attachment.path));
  });
  res.render('post', { title: post.title, post, comments });
});

router.post('/publicaciones/:id/comentarios', requireUser, (req, res) => {
  const postId = Number.parseInt(req.params.id, 10);
  const submittedContent = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const content = sanitizeRichContent(submittedContent);
  const textContent = richContentToText(content);
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
  const mediaPaths = submittedMediaPaths(req, content);
  if (!mediaPaths) {
    return validationError(req, res, 400, 'La lista de adjuntos no es válida.', `/publicaciones/${postId}`);
  }
  const submissionKey = typeof req.body.submission_key === 'string' ? req.body.submission_key : '';
  if (submissionKey && !/^[a-f\d-]{36}$/i.test(submissionKey)) {
    return validationError(req, res, 400, 'El identificador del envío no es válido.', `/publicaciones/${postId}`);
  }
  if (submissionKey) {
    const previous = db.prepare(`
      SELECT id FROM comments WHERE user_id = ? AND submission_key = ?
    `).get(req.session.user.id, submissionKey);
    if (previous) {
      return sendSuccess(req, res, 200, 'La respuesta ya se había enviado.',
        `/publicaciones/${postId}?mensaje=${encodeURIComponent('Respuesta enviada.') }#comentarios`);
    }
  }
  const validContent = isValidRichContent(submittedContent, 50000, 2);
  if (submittedContent.length > 50000 || textContent.length > 2000
      || (!validContent && mediaPaths.length === 0)) {
    return validationError(req, res, 422,
      'La respuesta debe tener entre 2 y 2.000 caracteres o incluir un archivo adjunto.',
      `/publicaciones/${postId}`);
  }
  const stagedMedia = findStagedMedia(mediaPaths, req.session.user.id);
  if (stagedMedia.length !== mediaPaths.length) {
    return validationError(req, res, 422,
      'Vuelve a adjuntar cualquier archivo que no pertenezca a tu sesión.', `/publicaciones/${postId}`);
  }
  const createComment = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO comments (post_id, user_id, content, submission_key) VALUES (?, ?, ?, ?)
    `).run(postId, req.session.user.id, content, submissionKey || null);
    const attach = db.prepare(`
      UPDATE attachments SET post_id = ?, comment_id = ?
      WHERE id = ? AND user_id = ? AND post_id IS NULL AND comment_id IS NULL
    `);
    for (const item of stagedMedia) {
      if (attach.run(postId, result.lastInsertRowid, item.id, req.session.user.id).changes !== 1) {
        throw new Error('An uploaded attachment could not be associated with its comment.');
      }
    }
    return result;
  });
  try {
    createComment();
  } catch (error) {
    if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE' || !submissionKey) throw error;
    return sendSuccess(req, res, 200, 'La respuesta ya se había enviado.',
      `/publicaciones/${postId}?mensaje=${encodeURIComponent('Respuesta enviada.')}#comentarios`);
  }
  return sendSuccess(req, res, 201, 'Respuesta enviada.',
    `/publicaciones/${postId}?mensaje=${encodeURIComponent('Respuesta enviada.')}#comentarios`);
});

router.post('/publicaciones/:id/eliminar', requireUser, requireRole('moderator', 'admin', 'ceo'), (req, res) => {
  const postId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(postId) || postId < 1) return notFound(res, 'No encontramos esta publicación.');
  const removePost = db.transaction(() => {
    return db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
  });
  const result = removePost();
  if (!result.changes) return notFound(res, 'No encontramos esta publicación.');
  res.redirect('/foros?mensaje=' + encodeURIComponent('Publicación eliminada por moderación.'));
});

router.post('/publicaciones/:id/comentarios/:commentId/eliminar',
  requireUser, requireRole('moderator', 'admin', 'ceo'), (req, res) => {
    const postId = Number.parseInt(req.params.id, 10);
    const commentId = Number.parseInt(req.params.commentId, 10);
    if (!Number.isSafeInteger(postId) || postId < 1
        || !Number.isSafeInteger(commentId) || commentId < 1) {
      return notFound(res, 'No encontramos esta respuesta.');
    }
    const result = db.prepare('DELETE FROM comments WHERE id = ? AND post_id = ?')
      .run(commentId, postId);
    if (!result.changes) return notFound(res, 'No encontramos esta respuesta.');
    res.redirect(`/publicaciones/${postId}?mensaje=` + encodeURIComponent('Respuesta eliminada por moderación.') + '#comentarios');
  });

module.exports = router;
