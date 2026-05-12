const express = require('express');
const router = express.Router();
const SreRepository = require('../services/SreRepository');
const verifyToken = require('../middlewares/auth');
const { checkRole } = require('../middlewares/rbac');
const { readLimit } = require('../middlewares/rateLimiter');

/**
 * @swagger
 * tags:
 *   name: SRE
 *   description: SRE & Telemetry endpoints
 */

/**
 * @swagger
 * /api/sre/recent-events:
 *   get:
 *     summary: Obtém os eventos recentes de SRE (Admin only)
 *     tags: [SRE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Lista de eventos SRE
 *       403:
 *         description: Não autorizado
 */
router.get('/recent-events', 
  verifyToken, 
  checkRole('admin'), 
  readLimit, 
  async (req, res) => {
    try {
      const { severity, limit } = req.query;
      const logs = await SreRepository.getRecentLogs({ 
        severity, 
        limit: limit ? parseInt(limit) : 50 
      });
      
      res.json({
        success: true,
        count: logs.length,
        data: logs
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * @backend/eloscloudapp/swagger.js
 * /api/sre/feedback:
 *   post:
 *     summary: Registra feedback sobre um diagnóstico de IA (Admin only)
 *     tags: [SRE]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               correlation_id:
 *                 type: string
 *               feedback:
 *                 type: string
 *                 enum: [accept, reject]
 *               comment:
 *                 type: string
 *               classification:
 *                 type: string
 *               rca:
 *                 type: string
 *     responses:
 *       200:
 *         description: Feedback registrado com sucesso
 */
router.post('/feedback',
  verifyToken,
  checkRole('admin'),
  async (req, res) => {
    try {
      await SreRepository.saveFeedback(req.body);
      res.json({ success: true, message: 'Feedback recorded for future learning.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
