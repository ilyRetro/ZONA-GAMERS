const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../database/connection');
const { requireUser } = require('./auth');
const { canAssignRole, roleLabels, requireRole } = require('../services/roles');
const { createAvatarPreview, removeMedia, saveAvatarImage } = require('../services/media');

const router = express.Router();
const avatarSizeLimit = 20 * 1024 * 1024;
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: avatarSizeLimit, files: 1 },
  fileFilter: (req, file, callback) => callback(null, true)
}).single('avatar');

function respond(req, res, status, message, data = {}) {
  if (req.get('accept')?.includes('application/json')) {
    return res.status(status).json({ message, ...data });
  }
  const query = status >= 400 ? 'error' : 'mensaje';
  return res.redirect(`/perfil/editar?${query}=` + encodeURIComponent(message));
}

function reportAvatarFailure(req, res, operation, error) {
  console.error(
    'Avatar %s failed for user %s:\n%s',
    operation,
    req.session?.user?.id || 'unknown',
    error.stack || error
  );
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const detail = error.message || 'Error desconocido';
  return respond(req, res, status, `No se pudo ${operation}: ${detail}`);
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function removeStoredAvatar(avatar) {
  const match = typeof avatar === 'string'
    ? avatar.match(/^\/uploads\/([a-f\d-]{36}\.(?:jpg|png|webp|gif))$/i)
    : null;
  if (!match) return;
  try {
    await removeMedia(match[1]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

router.get('/perfil/editar', requireUser, (req, res) => {
  const user = db.prepare(`
    SELECT id, username, email, avatar, bio, role, created_at, username_changed_at
    FROM users WHERE id = ?
  `).get(req.session.user.id);
  const pendingEmailChange = db.prepare(`
    SELECT email, requested_at FROM email_change_requests
    WHERE user_id = ? AND status = 'awaiting_email_provider'
    ORDER BY id DESC LIMIT 1
  `).get(user.id);
  res.render('edit-profile', {
    title: 'Editar perfil',
    user,
    pendingEmailChange,
    usernameChangeAvailableAt: user.username_changed_at
      ? new Date(new Date(user.username_changed_at).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString()
      : null
  });
});

router.post('/perfil/editar', requireUser, (req, res) => {
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
  if (bio.length > 500) return respond(req, res, 400, 'La biografía no puede superar los 500 caracteres.');
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.session.user.id);
  respond(req, res, 200, 'Biografía actualizada.');
});

router.post('/perfil/avatar/preview', requireUser, (req, res) => {
  avatarUpload(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError instanceof multer.MulterError
        ? uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400
        : uploadError.status || 400;
      return respond(req, res, status, status === 413
        ? 'La fotografía original no puede superar los 20 MB.'
        : uploadError.message || 'No se pudo procesar la fotografía.');
    }
    if (!req.file) return respond(req, res, 400, 'Selecciona una fotografía.');

    try {
      const preview = await createAvatarPreview(req.file);
      res
        .type('image/jpeg')
        .set('Cache-Control', 'no-store')
        .set('X-Content-Type-Options', 'nosniff')
        .send(preview);
    } catch (error) {
      if (error.status === 400) return respond(req, res, 400, error.message);
      reportAvatarFailure(req, res, 'preparar la fotografía', error);
    }
  });
});

router.post('/perfil/avatar', requireUser, (req, res) => {
  avatarUpload(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError instanceof multer.MulterError
        ? uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400
        : uploadError.status || 400;
      return respond(req, res, status, status === 413
        ? 'La fotografía original no puede superar los 20 MB.'
        : uploadError.message || 'No se pudo procesar la imagen.');
    }
    if (!req.file) return respond(req, res, 400, 'Selecciona una imagen para tu avatar.');

    let media;
    try {
      const currentAvatar = db.prepare('SELECT avatar FROM users WHERE id = ?')
        .get(req.session.user.id).avatar;
      media = await saveAvatarImage(req.file);
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?')
        .run(media.url, req.session.user.id);
      req.session.user.avatar = media.url;
      req.session.save(async (saveError) => {
        if (saveError) return reportAvatarFailure(req, res, 'actualizar la sesión del avatar', saveError);
        try {
          await removeStoredAvatar(currentAvatar);
          respond(req, res, 200, 'Avatar actualizado.', { avatar: media.url });
        } catch (error) {
          console.error('Avatar was updated but the previous file could not be removed:\n%s', error.stack || error);
          respond(req, res, 200, `Avatar actualizado, pero no se pudo eliminar el archivo anterior: ${error.message}`, {
            avatar: media.url
          });
        }
      });
    } catch (error) {
      if (media) {
        try {
          await removeMedia(media.filename);
        } catch (cleanupError) {
          console.error('Unable to remove an uncommitted avatar %s:\n%s', media.filename, cleanupError.stack || cleanupError);
        }
      }
        if (error.status === 400) {
          return respond(req, res, 400, error.message);
        }
        reportAvatarFailure(req, res, 'guardar el avatar', error);
    }
  });
});

router.post('/perfil/avatar/eliminar', requireUser, (req, res, next) => {
  const currentAvatar = db.prepare('SELECT avatar FROM users WHERE id = ?')
    .get(req.session.user.id).avatar;
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.session.user.id);
  req.session.user.avatar = null;
  req.session.save(async (error) => {
    if (error) return next(error);
    try {
      await removeStoredAvatar(currentAvatar);
      respond(req, res, 200, 'Avatar eliminado.', { avatar: null });
    } catch (removeError) {
      next(removeError);
    }
  });
});

router.post('/perfil/cambiar-nombre', requireUser, (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) {
    return respond(req, res, 400, 'El usuario debe tener entre 3 y 24 letras, números, guiones o guiones bajos.');
  }
  const changeUsername = db.transaction(() => {
    const user = db.prepare('SELECT username, username_changed_at FROM users WHERE id = ?')
      .get(req.session.user.id);
    const availableAt = user.username_changed_at
      ? new Date(new Date(user.username_changed_at).getTime() + 15 * 24 * 60 * 60 * 1000)
      : null;
    if (availableAt && availableAt.getTime() > Date.now()) {
      return {
        error: `Podrás cambiar tu usuario nuevamente el ${new Intl.DateTimeFormat('es', {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(availableAt)}.`
      };
    }
    if (user.username.toLocaleLowerCase() === username.toLocaleLowerCase()) {
      return { error: 'Elige un nombre distinto al actual.' };
    }
    try {
      db.prepare(`
        UPDATE users SET username = ?, username_changed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(username, req.session.user.id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { error: 'Ese nombre de usuario ya está en uso.' };
      }
      throw error;
    }
    return { username };
  });
  const result = changeUsername();
  if (result.error) return respond(req, res, 409, result.error);
  req.session.user.username = result.username;
  req.session.save((error) => {
    if (error) return res.status(500).json({ error: 'El nombre se guardó, pero no se pudo actualizar la sesión.' });
    respond(req, res, 200, 'Nombre de usuario actualizado.', {
      username: result.username,
      redirect: `/perfil/${encodeURIComponent(result.username)}`
    });
  });
});

router.post('/perfil/cambiar-correo', requireUser, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const account = db.prepare('SELECT email, password FROM users WHERE id = ?').get(req.session.user.id);
  if (!validEmail(email)) return respond(req, res, 400, 'Ingresa un correo electrónico válido.');
  if (!bcrypt.compareSync(currentPassword, account.password)) {
    return respond(req, res, 403, 'La contraseña actual es incorrecta.');
  }
  if (email === account.email.toLowerCase()) {
    return respond(req, res, 400, 'El correo nuevo debe ser diferente al actual.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
    return respond(req, res, 409, 'Ese correo ya está asociado a otra cuenta.');
  }

  const requestEmailChange = db.transaction(() => {
    db.prepare(`
      UPDATE email_change_requests SET status = 'cancelled'
      WHERE user_id = ? AND status = 'awaiting_email_provider'
    `).run(req.session.user.id);
    db.prepare(`
      INSERT INTO email_change_requests (user_id, email, status)
      VALUES (?, ?, 'awaiting_email_provider')
    `).run(req.session.user.id, email);
  });
  requestEmailChange();
  return respond(req, res, 202,
    'La solicitud quedó pendiente. Este servidor no tiene correo de verificación configurado; tu correo actual no se ha cambiado.');
});

router.post('/perfil/cambiar-contrasena', requireUser, (req, res) => {
  const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmation = typeof req.body.confirm_password === 'string' ? req.body.confirm_password : '';
  const account = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(currentPassword, account.password)) {
    return respond(req, res, 403, 'La contraseña actual es incorrecta.');
  }
  if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
    return respond(req, res, 400, 'La nueva contraseña debe tener entre 10 y 72 bytes.');
  }
  if (password !== confirmation) return respond(req, res, 400, 'Las contraseñas nuevas no coinciden.');
  const passwordHash = bcrypt.hashSync(password, 12);
  const updatePassword = db.transaction(() => {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, req.session.user.id);
    const sessions = db.prepare('SELECT sid, sess FROM sessions WHERE sid != ?').all(req.sessionID);
    const removeSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
    for (const session of sessions) {
      try {
        if (JSON.parse(session.sess).user?.id === req.session.user.id) removeSession.run(session.sid);
      } catch (error) {
        console.error('Skipping invalid persisted session while revoking password sessions:\n%s', error.stack || error);
      }
    }
  });
  updatePassword();
  respond(req, res, 200, 'Contraseña actualizada. Las demás sesiones se cerraron.');
});

router.post('/perfil/:username/rol', requireUser, requireRole('admin', 'ceo'), (req, res) => {
  const requestedRole = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
  const target = db.prepare('SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE')
    .get(req.params.username);
  if (!target) return respond(req, res, 404, 'No encontramos a este miembro.');
  if (!canAssignRole(req.session.user, target, requestedRole)) {
    const message = 'No tienes permiso para asignar ese rol a este miembro.';
    if (req.get('accept')?.includes('application/json')) return res.status(403).json({ error: message });
    return res.status(403).render('error', {
      title: 'Acceso denegado',
      statusCode: 403,
      message
    });
  }
  if (target.role === requestedRole) return respond(req, res, 400, 'El miembro ya tiene ese rol.');

  const updateRole = db.transaction(() => {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(requestedRole, target.id);
    db.prepare(`
      INSERT INTO role_change_audit
        (actor_user_id, target_user_id, previous_role, new_role, reason)
      VALUES (?, ?, ?, ?, 'Profile role management')
    `).run(req.session.user.id, target.id, target.role, requestedRole);
  });
  updateRole();
  respond(req, res, 200, `Rol de ${target.username} actualizado a ${roleLabels[requestedRole]}.`);
});

router.get('/perfil/:username', (req, res) => {
  const user = db.prepare(`
    SELECT id, username, avatar, bio, role, created_at FROM users
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
    SELECT posts.*, categories.name AS category_name, users.username, users.avatar, users.role,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count,
      (SELECT path FROM attachments WHERE attachments.post_id = posts.id
        AND attachments.comment_id IS NULL AND attachments.mime_type LIKE 'image/%'
        ORDER BY attachments.id LIMIT 1) AS preview_image,
      (SELECT COUNT(*) FROM attachments WHERE attachments.post_id = posts.id
        AND attachments.comment_id IS NULL) AS attachment_count
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN categories ON categories.id = posts.category_id
    WHERE posts.user_id = ? ORDER BY posts.created_at DESC LIMIT 20
  `).all(user.id);
  const recentComments = db.prepare(`
    SELECT comments.id, comments.post_id, comments.content, comments.created_at,
      posts.title AS post_title, categories.name AS category_name
    FROM comments
    JOIN posts ON posts.id = comments.post_id
    LEFT JOIN categories ON categories.id = posts.category_id
    WHERE comments.user_id = ?
    ORDER BY comments.created_at DESC LIMIT 10
  `).all(user.id);
  const commentCount = db.prepare('SELECT COUNT(*) AS count FROM comments WHERE user_id = ?')
    .get(user.id).count;
  const postCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?')
    .get(user.id).count;
  const roleAudit = req.session.user?.role === 'ceo'
    ? db.prepare(`
      SELECT role_change_audit.previous_role, role_change_audit.new_role,
        role_change_audit.reason, role_change_audit.created_at,
        actor.username AS actor_username
      FROM role_change_audit
      LEFT JOIN users AS actor ON actor.id = role_change_audit.actor_user_id
      WHERE role_change_audit.target_user_id = ?
      ORDER BY role_change_audit.created_at DESC LIMIT 10
    `).all(user.id)
    : [];
  res.render('profile', {
    title: `Perfil de ${user.username}`,
    profile: user,
    posts,
    recentComments,
    roleAudit,
    postCount,
    commentCount,
    isOwnProfile: req.session.user?.id === user.id,
    canManageRoles: ['admin', 'ceo'].includes(req.session.user?.role),
    availableRoles: req.session.user?.role === 'ceo'
      ? ['user', 'support', 'moderator', 'admin', 'ceo']
      : ['user', 'support', 'moderator'],
    canEditTargetRole: req.session.user?.id !== user.id
      && (req.session.user?.role === 'ceo' || !['admin', 'ceo'].includes(user.role))
  });
});

module.exports = router;
