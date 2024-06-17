const express = require('express');
const router = express.Router();
const videoSdkController = require('../controllers/videoSdkController');
const verifyToken = require('../middlewares/auth');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3001'];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

router.post('/get-token', videoSdkController.getToken);
router.post('/start-session', verifyToken, videoSdkController.startSession);
router.post('/end-session', verifyToken, videoSdkController.endSession);
router.post('/create-meeting', verifyToken, videoSdkController.createMeeting);
router.post('/validate-meeting/:meetingId', verifyToken, videoSdkController.validateMeeting);

module.exports = router;
