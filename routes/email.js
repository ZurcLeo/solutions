const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');

// Rota OPTIONS para lidar com requisições preflight
router.options('*', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

router.post('/send-invite', emailController.sendInviteEmail);

module.exports = router;
