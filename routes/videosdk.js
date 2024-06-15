const express = require('express');
const videoSdkController = require('../controllers/videoSdkController');
const router = express.Router();
const verifyToken = require('../middlewares/auth');

// Add CORS headers for all requests
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

router.post('/start-session', verifyToken, videoSdkController.startSession);
router.post('/end-session', verifyToken, videoSdkController.endSession);
router.get('/turn-credentials', verifyToken, videoSdkController.getTurnCredentials);
router.post('/create-meeting', verifyToken, videoSdkController.createMeeting);

module.exports = router;
