const express = require('express');
const router = express.Router();
const { calculateJA3 } = require('../controllers/ja3Controller');

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

router.post('/calculate', calculateJA3);

module.exports = router;
