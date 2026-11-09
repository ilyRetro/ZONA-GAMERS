function getOnlineMembers(db, now = Date.now()) {
  const activeSessions = db.prepare(`
    SELECT sess, last_seen
    FROM sessions
    WHERE expires > ? AND last_seen >= ?
    ORDER BY last_seen DESC
  `).all(now, now - 5 * 60 * 1000);
  const latestActivityByUser = new Map();

  for (const activeSession of activeSessions) {
    let session;
    try {
      session = JSON.parse(activeSession.sess);
    } catch (error) {
      console.error('Skipping invalid persisted session while resolving online members:\n%s', error.stack || error);
      continue;
    }

    const userId = session?.user?.id;
    if (Number.isSafeInteger(userId) && userId > 0 && !latestActivityByUser.has(userId)) {
      latestActivityByUser.set(userId, activeSession.last_seen);
    }
  }

  const getUser = db.prepare('SELECT id, username, avatar, role FROM users WHERE id = ?');
  return [...latestActivityByUser.entries()]
    .map(([userId, lastSeen]) => {
      const user = getUser.get(userId);
      return user ? { ...user, last_seen: lastSeen } : null;
    })
    .filter(Boolean);
}

module.exports = { getOnlineMembers };
