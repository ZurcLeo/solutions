// /Users/leocruz/Documents/Projects/eloscloud/backend/eloscloudapp/routes/support.js
const express = require('express');
const router = express.Router();
const supportController = require('../controllers/SupportController');
const verifyToken = require('../middlewares/auth');
const { checkPermission, checkRole } = require('../middlewares/rbac');
const { writeLimit, readLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'support';
router.use(healthCheck(ROUTE_NAME)); // Apply health check

// Log all requests to this router
router.use((req, res, next) => {
  logger.info(`[ROUTE] Request received in ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    body: req.body, // Be cautious logging full body in production
    query: req.query,
  });
  next();
});

router.use(verifyToken); // All support routes require authentication

/**
 * @swagger
 * tags:
 *   name: Support
 *   description: Support ticket and human escalation management
 */

/**
 * @swagger
 * /api/support/tickets:
 *   post:
 *     summary: Create a new support ticket
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [financial, caixinha, loan, account, technical, security, general]
 *                 description: Category of the issue
 *               module:
 *                 type: string
 *                 description: Specific module where issue occurred
 *               issueType:
 *                 type: string
 *                 description: Specific type of issue
 *               title:
 *                 type: string
 *                 description: Brief title of the issue
 *               description:
 *                 type: string
 *                 description: Detailed description of the issue
 *               context:
 *                 type: object
 *                 description: Additional context data (e.g., transaction ID, caixinha ID)
 *               deviceInfo:
 *                 type: object
 *                 description: Device information
 *               userAgent:
 *                 type: string
 *                 description: User agent string
 *               sessionData:
 *                 type: object
 *                 description: Session data
 *     responses:
 *       200:
 *         description: Ticket created successfully
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.post('/tickets', writeLimit, supportController.createTicket);

/**
 * @swagger
 * /api/support/escalate:
 *   post:
 *     summary: (Legacy) User requests human escalation for a conversation
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: string
 *                 description: ID of the conversation to escalate
 *               reason:
 *                 type: string
 *                 description: Reason for escalation
 *     responses:
 *       200:
 *         description: Escalation request submitted or already in progress
 *       400:
 *         description: Missing conversationId
 *       500:
 *         description: Server error
 */
router.post('/escalate', writeLimit, supportController.requestEscalation);

// --- Agent/Admin Routes ---
// These routes would typically be protected by RBAC (e.g., checkRole('agent') or checkPermission('support:view_queue'))

/**
 * @swagger
 * /api/support/tickets/my:
 *   get:
 *     summary: Get user's own support tickets
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by ticket status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Max number of tickets to return
 *     responses:
 *       200:
 *         description: List of user's tickets
 *       500:
 *         description: Server error
 */
router.get('/tickets/my', readLimit, supportController.getUserTickets);

/**
 * @swagger
 * /api/support/tickets/pending:
 *   get:
 *     summary: (Agent/Admin) Get pending support tickets
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Max number of tickets to return
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *         description: Filter by priority
 *     responses:
 *       200:
 *         description: List of pending tickets
 *       500:
 *         description: Server error
 */
router.get('/tickets/pending', readLimit, checkPermission('support:manage_tickets'), supportController.getPendingTickets);

/**
 * @swagger
 * /api/support/tickets/category/{category}:
 *   get:
 *     summary: (Agent/Admin) Get tickets by category
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *         description: Category to filter by
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Max number of tickets to return
 *     responses:
 *       200:
 *         description: List of tickets in category
 *       500:
 *         description: Server error
 */
router.get('/tickets/category/:category', readLimit, checkPermission('support:manage_tickets'), supportController.getTicketsByCategory);

/**
 * @swagger
 * /api/support/tickets/analytics:
 *   get:
 *     summary: (Agent/Admin) Get support analytics
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Time range in days
 *     responses:
 *       200:
 *         description: Support analytics data
 *       500:
 *         description: Server error
 */
router.get('/tickets/analytics', readLimit, checkPermission('support:view_analytics'), supportController.getAnalytics);

/**
 * @swagger
 * /api/support/tickets/assigned:
 *   get:
 *     summary: (Agent) Get tickets assigned to the current agent
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: "assigned"
 *         description: Filter by ticket status (e.g., assigned, resolved)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Max number of tickets to return
 *     responses:
 *       200:
 *         description: List of agent's tickets
 *       500:
 *         description: Server error
 */
router.get('/tickets/assigned', readLimit, checkPermission('support:manage_tickets'), supportController.getAgentTickets);

/**
 * @swagger
 * /api/support/tickets/all:
 *   get:
 *     summary: (Agent/Admin) Get all support tickets in the system
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by ticket status (optional)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Max number of tickets to return
 *     responses:
 *       200:
 *         description: List of all tickets
 *       500:
 *         description: Server error
 */
router.get('/tickets/all', readLimit, checkPermission('support:manage_tickets'), supportController.getAllTickets);

/**
 * @swagger
 * /api/support/tickets/{ticketId}/assign:
 *   post:
 *     summary: (Agent/Admin) Assign a support ticket
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the ticket to assign
 *     responses:
 *       200:
 *         description: Ticket assigned successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 */
router.post('/tickets/:ticketId/assign', writeLimit, checkPermission('support:manage_tickets'), supportController.assignTicket);

/**
 * @swagger
 * /api/support/tickets/{ticketId}/resolve:
 *   post:
 *     summary: (Agent) Resolve a support ticket
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the ticket to resolve
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resolutionNotes:
 *                 type: string
 *                 description: Notes on how the ticket was resolved
 *               resolutionSummary:
 *                 type: string
 *                 description: Brief summary of the resolution
 *     responses:
 *       200:
 *         description: Ticket resolved successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 */
router.post('/tickets/:ticketId/resolve', writeLimit, checkPermission('support:manage_tickets'), supportController.resolveTicket);

/**
 * @swagger
 * /api/support/tickets/{ticketId}/status:
 *   put:
 *     summary: (Agent) Update ticket status
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the ticket to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, assigned, in_progress, resolved, closed]
 *                 description: New status for the ticket
 *               note:
 *                 type: string
 *                 description: Optional note about the status change
 *     responses:
 *       200:
 *         description: Ticket status updated successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 */
router.put('/tickets/:ticketId/status', writeLimit, checkPermission('support:manage_tickets'), supportController.updateTicketStatus);

/**
 * @swagger
 * /api/support/tickets/{ticketId}/conversation:
 *   get:
 *     summary: (Agent) Get conversation history for a support ticket
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the ticket
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Max number of messages to return
 *     responses:
 *       200:
 *         description: Conversation history
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 */
router.get('/tickets/:ticketId/conversation', readLimit, checkPermission('support:manage_tickets'), supportController.getConversationForTicket);

/**
 * @swagger
 * /api/support/tickets/{ticketId}:
 *   get:
 *     summary: Get ticket details
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the ticket
 *     responses:
 *       200:
 *         description: Ticket details
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 *   put:
 *     summary: (Agent) Update ticket with notes or other fields
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the ticket to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Additional notes to add to the ticket
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, urgent]
 *                 description: Update ticket priority
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Update ticket tags
 *               internalNotes:
 *                 type: string
 *                 description: Internal notes (visible only to agents)
 *     responses:
 *       200:
 *         description: Ticket updated successfully
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Access denied
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 */
router.get('/tickets/:ticketId', readLimit, supportController.getTicketDetails);
router.put('/tickets/:ticketId', writeLimit, checkPermission('support:manage_tickets'), supportController.updateTicket);

module.exports = router;