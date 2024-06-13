const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/add-user', userController.addUser);
router.get('/get-user/:id', userController.getUser);
router.put('/update-user', userController.updateUser);

module.exports = router;
