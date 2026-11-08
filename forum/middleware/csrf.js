const crypto = require('crypto');

function csrfProtection(req, res, next) {
  req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const submitted = req.body?._csrf;
  const expected = req.session.csrfToken;
  if (typeof submitted !== 'string' || submitted.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected))) {
    return res.status(403).render('error', {
      title: 'Solicitud no válida',
      statusCode: 403,
      message: 'No pudimos verificar esta solicitud. Recarga la página e inténtalo de nuevo.'
    });
  }
  next();
}

module.exports = { csrfProtection };
