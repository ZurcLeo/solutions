const express = require('express');
const router = express.Router();
const caixinhaController = require('../controllers/caixinhaController');
const verifyToken = require('../middlewares/auth');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

router.get('/', verifyToken, caixinhaController.getCaixinhas);
router.get('/:id', verifyToken, caixinhaController.getCaixinhaById);
router.post('/', verifyToken, caixinhaController.createCaixinha);
router.put('/:id', verifyToken, caixinhaController.updateCaixinha);
router.delete('/:id', verifyToken, caixinhaController.deleteCaixinha);

module.exports = router;