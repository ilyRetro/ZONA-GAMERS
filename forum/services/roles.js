const roleLabels = {
  ceo: 'CEO',
  admin: 'ADMIN',
  moderator: 'MODERATOR',
  support: 'SOPORTE',
  user: 'MIEMBRO'
};

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      if (req.get('accept')?.includes('application/json')) {
        return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
      }
      return res.status(403).render('error', {
        title: 'Acceso denegado',
        statusCode: 403,
        message: 'No tienes permiso para realizar esta acción.'
      });
    }
    next();
  };
}

function canAssignRole(actor, target, requestedRole) {
  if (!actor || !target || actor.id === target.id
      || !Object.prototype.hasOwnProperty.call(roleLabels, requestedRole)) return false;
  if (actor.role === 'ceo') return true;
  if (actor.role !== 'admin') return false;
  return ['user', 'moderator', 'support'].includes(requestedRole)
    && ['user', 'moderator', 'support'].includes(target.role);
}

module.exports = { canAssignRole, roleLabels, requireRole };
