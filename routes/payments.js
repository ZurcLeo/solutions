const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/paymentsController');

// Rota OPTIONS para lidar com requisições preflight
router.options('/create-payment-intent', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

router.post('/create-payment-intent', paymentsController.createPaymentIntent);

router.get('/session-status', paymentsController.sessionStatus);

router.get('/purchases', paymentsController.getPurchases);

module.exports = router;
