// routes/email.js
const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const verifyToken = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const validate = require('../middlewares/validate');
const emailSchema = require('../schemas/emailSchema');
const { writeLimit, readLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'email';

// Apply health check middleware to all email routes
router.use(healthCheck(ROUTE_NAME));

// Logging middleware for all requests
router.use((req, res, next) => {
  logger.info(`[ROUTE] Request received in ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    body: req.body,
    query: req.query,
  });
  next();
});

/**
 * @swagger
 * tags:
 *   name: Email
 *   description: Email management endpoints
 */

/**
 * @swagger
 * /emails:
 *   post:
 *     summary: Send an email using a template
 *     tags: [Email]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *               - templateType
 *               - data
 *             properties:
 *               to:
 *                 type: string
 *                 description: Recipient email address
 *               subject:
 *                 type: string
 *                 description: Email subject
 *               templateType:
 *                 type: string
 *                 description: Type of email template to use
 *               data:
 *                 type: object
 *                 description: Data to pass to the template
 *               reference:
 *                 type: string
 *                 description: ID of related entity (e.g., inviteId)
 *               referenceType:
 *                 type: string
 *                 description: Type of reference (e.g., 'invite')
 *     responses:
 *       200:
 *         description: Email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 messageId:
 *                   type: string
 *                   description: Message ID returned by email provider
 *                 emailId:
 *                   type: string
 *                   description: ID of the email record
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
router.post('/', verifyToken, writeLimit, validate(emailSchema.send), emailController.sendEmail);

/**
 * @swagger
 * /emails/user:
 *   get:
 *     summary: Get all emails sent by the current user
 *     tags: [Email]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of emails
 *       500:
 *         description: Server error
 */
router.get('/user', verifyToken, readLimit, emailController.getUserEmails);

/**
 * @swagger
 * /emails/reference/{referenceType}/{referenceId}:
 *   get:
 *     summary: Get emails by reference type and ID
 *     tags: [Email]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: referenceType
 *         required: true
 *         schema:
 *           type: string
 *         description: Type of reference (e.g., invite)
 *       - in: path
 *         name: referenceId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the reference
 *     responses:
 *       200:
 *         description: List of emails related to the reference
 *       500:
 *         description: Server error
 */
router.get('/reference/:referenceType/:referenceId', verifyToken, readLimit, emailController.getEmailsByReference);

/**
 * @swagger
 * /emails/{emailId}/resend:
 *   post:
 *     summary: Resend an email
 *     tags: [Email]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: emailId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the email to resend
 *     responses:
 *       200:
 *         description: Email resent successfully
 *       403:
 *         description: Not authorized to resend this email
 *       500:
 *         description: Server error
 */
router.post('/:emailId/resend', verifyToken, writeLimit, validate(emailSchema.resend), emailController.resendEmail);

/**
 * @swagger
 * /emails/admin/status/{status}:
 *   get:
 *     summary: (Admin) Get emails by status
 *     tags: [Email]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [pending, sent, error, resent]
 *         description: Status of emails to retrieve
 *     responses:
 *       200:
 *         description: List of emails with the specified status
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/status/:status', verifyToken, isAdmin, readLimit, emailController.getEmailsByStatus);

/**
 * Legacy route for backward compatibility
 * @deprecated Use the new email routes instead
 */
router.post('/send-invite', verifyToken, writeLimit, async (req, res) => {
  logger.warn('Using deprecated email route', {
    service: 'emailRoutes',
    function: 'send-invite'
  });
  
  const result = await emailController.sendInviteEmail(req.body);
  return res.status(result.status).json(result.json);
});

module.exports = router;