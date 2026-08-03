const express = require('express');
const router = express.Router();
const stickerController = require('../controllers/stickerController');
const verifyToken = require('../middlewares/auth');
const { readLimit } = require('../middlewares/rateLimiter');

router.get('/', verifyToken, readLimit, stickerController.listStickers);

module.exports = router;
