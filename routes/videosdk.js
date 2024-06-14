const express = require('express');
const videoSdkController = require('../controllers/videoSdkController');
const router = express.Router();
const verifyToken = require('../middlewares/auth');

router.post('/start-session', verifyToken, videoSdkController.startSession);
router.post('/end-session', verifyToken, videoSdkController.endSession);
router.get('/turn-credentials', verifyToken, videoSdkController.getTurnCredentials);
router.post('/create-meeting', verifyToken, videoSdkController.createMeeting);

module.exports = router;
