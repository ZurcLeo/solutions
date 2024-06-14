const express = require('express');
const { getTurnCredentials, startSession, endSession } = require('../controllers/videoSdkController');
const router = express.Router();

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

router.get('/turn-credentials', getTurnCredentials);
router.post('/start-session', startSession);
router.post('/end-session', endSession);

module.exports = router;
