// routes/notifications.js
const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const verifyToken = require('../middlewares/auth');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});
  
  router.get('/:userId', verifyToken, notificationsController.getUserNotifications);
  router.post('/:userId/markAsRead', verifyToken, notificationsController.markAsRead);
  
  module.exports = router;