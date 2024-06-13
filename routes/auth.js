const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/facebook-login', authController.facebookLogin);
router.get('/facebook-friends', authController.getFacebookFriends);

module.exports = router;
