require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('./database/session-store');
const db = require('./database/connection');
const authRoutes = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const profileRoutes = require('./routes/profile');
const { getDiscordStats } = require('./services/discord');
const { richContentToText, sanitizeRichContent } = require('./services/rich-content');
const { uploadsDirectory } = require('./services/media');
const { roleLabels } = require('./services/roles');
const { csrfProtection } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET es obligatorio en producción.');
}
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.title = 'ZONA GAMERS';
app.locals.pageTitle = 'ZONA GAMERS';
app.locals.currentUser = null;
app.locals.csrfToken = '';
app.locals.notice = '';
app.locals.error = '';
app.locals.stats = { users: 0, posts: 0, online: 0 };
app.locals.recentPosts = [];
app.locals.activity = [];
app.locals.categories = [];
app.locals.selectedCategory = null;
app.locals.members = [];
app.locals.post = {
  id: 0,
  title: 'Publicación',
  content: '',
  category_name: 'Comunidad',
  created_at: '',
  username: 'Miembro',
  avatar: null,
  comment_count: 0
};
app.locals.comments = [];
app.locals.profile = {
  username: 'Miembro',
  avatar: null,
  bio: '',
  created_at: ''
};
app.locals.posts = [];
app.locals.postCount = 0;
app.locals.commentCount = 0;
app.locals.isOwnProfile = false;
app.locals.user = { username: '', email: '', bio: '', avatar: null };
app.locals.statusCode = 500;
app.locals.message = 'Ocurrió un error inesperado. Inténtalo de nuevo.';
app.locals.formatDate = (date) => {
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime())
    ? ''
    : new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(parsedDate);
};
app.locals.formatDateTime = (date) => {
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime())
    ? ''
    : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(parsedDate);
};
app.locals.richContentToText = richContentToText;
app.locals.sanitizeRichContent = sanitizeRichContent;
app.locals.roleLabels = roleLabels;
fs.mkdirSync(uploadsDirectory, { recursive: true });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      frameSrc: ['https://discord.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'", 'https://discord.com'],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '400kb' }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'zona.sid',
  secret: sessionSecret,
  store: new SQLiteStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
const getSessionUser = db.prepare('SELECT id, username, email, avatar, role FROM users WHERE id = ?');
const updateSessionActivity = db.prepare('UPDATE sessions SET last_seen = ? WHERE sid = ?');
app.use((req, res, next) => {
  if (Number.isSafeInteger(req.session?.user?.id)) {
    const account = getSessionUser.get(req.session.user.id);
    if (!account) {
      req.session.user = null;
    } else {
      for (const [field, value] of Object.entries(account)) {
        if (req.session.user[field] !== value) req.session.user[field] = value;
      }
      updateSessionActivity.run(Date.now(), req.sessionID);
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use('/uploads', express.static(uploadsDirectory, {
  dotfiles: 'deny',
  index: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  res.locals.csrfToken = req.session?.csrfToken || '';
  res.locals.title = 'ZONA GAMERS';
  res.locals.pageTitle = 'ZONA GAMERS';
  res.locals.notice = typeof req.query.mensaje === 'string' ? req.query.mensaje : '';
  res.locals.error = typeof req.query.error === 'string' ? req.query.error : '';
  next();
});

app.use('/', authRoutes);
app.get('/api/discord/stats', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getDiscordStats());
  } catch (error) {
    next(error);
  }
});
app.use('/', forumRoutes);
app.use('/', profileRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Página no encontrada',
    statusCode: 404,
    message: 'No encontramos la página que buscas.'
  });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error for %s %s:\n%s', req.method, req.path, error.stack || error);
  if (res.headersSent) return next(error);
  const statusCode = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const message = statusCode === 413
    ? 'La solicitud es demasiado grande.'
    : statusCode === 400
      ? 'La solicitud contiene datos no válidos.'
      : 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  if (req.get('accept')?.includes('application/json')) {
    return res.status(statusCode).json({ error: message });
  }
  res.status(statusCode).render('error', {
    title: statusCode === 500 ? 'Error del servidor' : 'Solicitud no válida',
    statusCode,
    message
  });
});

app.listen(PORT, () => {
  console.log(`ZONA GAMERS activo en http://localhost:${PORT}`);
});

module.exports = app;
