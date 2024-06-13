const express = require('express');
const router = express.Router();
const recaptchaController = require('../controllers/recaptchaController');

// Rota OPTIONS para lidar com requisições preflight
router.options('*', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

router.post('/verify', recaptchaController.verifyRecaptcha);

module.exports = router;
