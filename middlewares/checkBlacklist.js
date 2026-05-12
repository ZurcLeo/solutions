const { isLocallyBlacklisted } = require('../utils/securityUtils');
const { logger } = require('../logger');

/**
 * Middleware para bloquear requisições de IPs ou usuários na blacklist local
 */
const checkBlacklist = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.user?.uid;
  const ja3Hash = req.headers['x-ja3-hash'];

  if (isLocallyBlacklisted(ip)) {
    logger.warn('Blocked request from blacklisted IP', { ip, path: req.path });
    return res.status(403).json({ error: 'Access denied: IP blacklisted' });
  }

  if (ja3Hash && isLocallyBlacklisted(ja3Hash)) {
    logger.warn('Blocked request from blacklisted JA3 Fingerprint', { ja3Hash, path: req.path });
    return res.status(403).json({ error: 'Access denied: Fingerprint blacklisted' });
  }

  if (userId && isLocallyBlacklisted(userId)) {
    logger.warn('Blocked request from blacklisted user', { userId, path: req.path });
    return res.status(403).json({ error: 'Access denied: User blacklisted' });
  }

  next();
};

module.exports = checkBlacklist;
