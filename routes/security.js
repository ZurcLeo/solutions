/**
 * @fileoverview Security Analytics Routes
 * @module routes/security
 */

const express = require('express');
const router = express.Router();
const SecurityController = require('../controllers/securityController');
const verifyToken = require('../middlewares/auth');
const { checkPermission, checkRole } = require('../middlewares/rbac');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');

const ROUTE_NAME = 'security';

// Log all requests to this router
router.use((req, res, next) => {
  logger.info(`[ROUTE] Request received in ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    query: req.query,
  });
  next();
});

router.use(verifyToken); // All security routes require authentication

/**
 * @swagger
 * tags:
 *   name: Security
 *   description: Security analytics and monitoring
 */

/**
 * @swagger
 * /api/security/dashboard:
 *   get:
 *     summary: Get security analytics dashboard
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d, 30d]
 *           default: 24h
 *         description: Time range for analytics
 *     responses:
 *       200:
 *         description: Security dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period:
 *                   type: object
 *                   properties:
 *                     timeRange:
 *                       type: string
 *                     startDate:
 *                       type: string
 *                     endDate:
 *                       type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalEvents:
 *                       type: number
 *                     riskDistribution:
 *                       type: object
 *                     topEventTypes:
 *                       type: array
 *                     affectedUsers:
 *                       type: number
 *                 trends:
 *                   type: object
 *                 alerts:
 *                   type: array
 *                 recommendations:
 *                   type: array
 *       403:
 *         description: Access denied
 *       500:
 *         description: Server error
 */
router.get('/dashboard', readLimit, SecurityController.getDashboard);

/**
 * @swagger
 * /api/security/user/{userId}/risk:
 *   get:
 *     summary: Get user risk analysis
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to analyze
 *     responses:
 *       200:
 *         description: User risk analysis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                 riskProfile:
 *                   type: object
 *                   properties:
 *                     finalScore:
 *                       type: number
 *                     riskLevel:
 *                       type: string
 *                       enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *                     components:
 *                       type: object
 *                     recommendations:
 *                       type: array
 *                     restrictions:
 *                       type: array
 *                 recentEvents:
 *                   type: array
 *                 recommendations:
 *                   type: array
 *                 summary:
 *                   type: object
 *       403:
 *         description: Access denied
 *       500:
 *         description: Server error
 */
router.get('/user/:userId/risk', readLimit, SecurityController.getUserRiskAnalysis);

/**
 * @swagger
 * /api/security/events:
 *   get:
 *     summary: Get security events (Admin only)
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Maximum number of events to return
 *       - in: query
 *         name: eventType
 *         schema:
 *           type: string
 *         description: Filter by event type
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: riskLevel
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *         description: Filter by risk level
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for events
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for events
 *     responses:
 *       200:
 *         description: Security events list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       userId:
 *                         type: string
 *                       eventType:
 *                         type: string
 *                       data:
 *                         type: object
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                 total:
 *                   type: number
 *                 filters:
 *                   type: object
 *                 summary:
 *                   type: object
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/events', readLimit, checkRole('admin'), SecurityController.getSecurityEvents);

/**
 * @swagger
 * /api/security/report:
 *   get:
 *     summary: Generate security report (Admin only)
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reportType
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *           default: weekly
 *         description: Type of report to generate
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Report format
 *       - in: query
 *         name: includeSummary
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include summary in report
 *       - in: query
 *         name: includeCharts
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include chart data in report
 *     responses:
 *       200:
 *         description: Security report generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *           text/csv:
 *             schema:
 *               type: string
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/report', readLimit, checkRole('admin'), SecurityController.generateSecurityReport);

/**
 * @swagger
 * /api/security/action:
 *   post:
 *     summary: Execute security action (Admin only)
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - targetUserId
 *               - reason
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [BLOCK_USER, UNBLOCK_USER, RESET_RISK_SCORE, REQUIRE_2FA, FLAG_FOR_REVIEW]
 *                 description: Security action to execute
 *               targetUserId:
 *                 type: string
 *                 description: ID of user to apply action to
 *               reason:
 *                 type: string
 *                 description: Reason for the action
 *               duration:
 *                 type: string
 *                 description: Duration for temporary actions (e.g., "24h", "7d")
 *     responses:
 *       200:
 *         description: Action executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 action:
 *                   type: string
 *                 targetUserId:
 *                   type: string
 *                 result:
 *                   type: object
 *                 executedAt:
 *                   type: string
 *                   format: date-time
 *                 executedBy:
 *                   type: string
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.post('/action', writeLimit, checkPermission('security:execute_actions'), SecurityController.executeSecurityAction);

module.exports = router;