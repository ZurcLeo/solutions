const express = require('express');
const { getTurnCredentials, startSession, endSession } = require('../controllers/videoSdkController');
const router = express.Router();
const verifyToken = require('../middlewares/auth');

// Adicionar cabeçalhos CORS para todas as solicitações
router.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

router.post('/start-session', verifyToken, videoSdkController.startSession);
router.post('/end-session', verifyToken, videoSdkController.endSession);
router.get('/turn-credentials', verifyToken, videoSdkController.getTurnCredentials);

module.exports = router;
