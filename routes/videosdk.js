// routes/videoSdk.js
const express = require('express');
const { getTurnCredentials, startSession, endSession } = require('../controllers/videoSdkController');
const router = express.Router();

router.get('/turn-credentials', getTurnCredentials);
router.post('/start-session', startSession);
router.post('/end-session', endSession);

module.exports = router;
