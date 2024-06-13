const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Rota OPTIONS para lidar com requisições preflight
router.options('*', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

router.post('/add-user', userController.addUser);
router.get('/get-user/:id', userController.getUser);
router.put('/update-user', userController.updateUser);

module.exports = router;
