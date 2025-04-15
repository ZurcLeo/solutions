// middlewares/optionalAuth.js
const jwt = require('jsonwebtoken');
const { logger } = require('../logger');
const { isTokenBlacklisted } = require('../services/blacklistService');

/**
 * Middleware that attempts to authenticate a user but continues even if authentication fails
 * Enables health checks to run with basic functionality without auth 
 * and enhanced functionality with auth
 */
const optionalAuth = async (req, res, next) => {
  let token;
  let refreshToken;
  
  // Extract tokens from headers or cookies
  const authHeader = req.headers['authorization'] || req.cookies['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (req.cookies && req.cookies.refreshToken) {
    refreshToken = req.cookies.refreshToken;
  }

  // If no tokens, continue as unauthenticated request
  if (!token && !refreshToken) {
    logger.info('Health check: No authentication provided, continuing with limited access', {
      service: 'optionalAuth',
      function: 'optionalAuth',
      path: req.path
    });
    req.isAuthenticated = false;
    return next();
  }

  try {
    // Verify the access token if present
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if token is blacklisted
      const isBlacklisted = await isTokenBlacklisted(token);
      if (isBlacklisted) {
        logger.warn('Health check: Blacklisted token provided', {
          service: 'optionalAuth',
          function: 'optionalAuth'
        });
        req.isAuthenticated = false;
        return next();
      }

      // Valid token, set user info
      req.user = decoded;
      req.uid = decoded.uid;
      req.isAuthenticated = true;

      logger.info('Health check: Authentication successful', {
        service: 'optionalAuth',
        function: 'optionalAuth',
        userId: req.uid
      });

      return next();
    }
    
    // If we have a refresh token but no valid access token, try refresh flow
    // For simplicity in health checks, we don't actually refresh, just note the attempt
    if (refreshToken) {
      logger.info('Health check: Only refresh token provided, continuing with limited access', {
        service: 'optionalAuth',
        function: 'optionalAuth'
      });
      req.isAuthenticated = false;
    }
    
    return next();

  } catch (error) {
    logger.info('Health check: Auth verification failed, continuing with limited access', {
      service: 'optionalAuth',
      function: 'optionalAuth',
      error: error.message
    });
    req.isAuthenticated = false;
    return next();
  }
};

module.exports = optionalAuth;