const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const {authSchemas} = require('../schemas/authSchemas');
const userSchema = require('../schemas/userSchema');
const { rateLimiter, authRateLimiter } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');
const firstAccess = require('../middlewares/firstAccess');

// Smart Security Middleware
const { 
  velocityCheck, 
  deviceCheck, 
  securityLogging 
} = require('../middlewares/smartSecurity');

const ROUTE_NAME = 'auth'
// Aplicar middleware de health check a todas as rotas de interests
router.use(healthCheck(ROUTE_NAME));

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, { sreContext: req.sreContext || 'no-context' });
  next();
});
/**
 * @swagger
 * /auth/session:
 *   get:
 *     summary: Verifica o estado atual da sessão
 *     description: Retorna informações sobre a sessão atual baseadas nos cookies de autenticação
 *     tags:
 *       - Autenticação
 *     responses:
 *       200:
 *         description: Estado da sessão.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authenticated:
 *                   type: boolean
 *                   description: Indica se o usuário está autenticado.
 *                   example: true
 *                 user:
 *                   type: object
 *                   description: Informações do usuário (se autenticado)
 *       401:
 *         description: Usuário não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authenticated:
 *                   type: boolean
 *                   example: false
 *       500:
 *         description: Erro ao verificar sessão.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/session')
  .get(rateLimiter, verifyToken, authController.checkSession);

/**
* @swagger
* /auth/register:
*   post:
*     summary: Registro com email e senha.
*     description: Cria uma nova conta de usuário usando email e senha.
*     tags:
*       - Autenticação
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/RegisterRequest'
*     responses:
*       200:
*         description: Conta criada com sucesso.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/AuthResponse'
*       500:
*         description: Erro ao criar conta.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
// Registro de usuário com análise de segurança
router.route('/register')
 .post(
   deviceCheck,                         // Análise de dispositivo
   velocityCheck('registration'),       // Verificação de velocity
   (req, res, next) => {
     // Logic de segurança para registro
     const velocityAnalysis = req.securityContext?.velocity;
     const deviceAnalysis = req.securityContext?.device;
     
     if (velocityAnalysis?.riskLevel === 'HIGH') {
       logger.warn('High velocity registration attempt blocked', {
         ip: req.ip,
         userAgent: req.get('User-Agent'),
         riskScore: velocityAnalysis.riskScore
       });
       
       return res.status(429).json({
         error: 'Too many registration attempts. Please try again later.',
         retryAfter: 3600,
         riskLevel: velocityAnalysis.riskLevel
       });
     }
     
     // Marcar se dispositivo é suspeito para validações adicionais
     if (deviceAnalysis?.riskScore > 0.7) {
       req.requireEmailVerification = true;
       req.securityNotice = 'Additional verification required due to security policies.';
     }
     
     next();
   },
   authRateLimiter, 
   firstAccess, 
   securityLogging,
   authController.register
 );
 
/**
* @swagger
* /auth/logout:
*   post:
*     summary: Realiza logout do usuário.
*     description: Encerra a sessão do usuário e coloca o token na blacklist.
*     tags:
*       - Autenticação
*     security:
*       - bearerAuth: []
*     responses:
*       200:
*         description: Logout bem-sucedido.
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 message:
*                   type: string
*                   description: Mensagem de sucesso.
*                   example: "Logout successful and token blacklisted"
*       500:
*         description: Erro ao realizar logout.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
router.route('/logout')
 .post(rateLimiter, verifyToken, validate(userSchema), authController.logout);

 /**
* @swagger
* /auth/register-with-provider:
*   post:
*     summary: Registro com provedor externo.
*     description: Registra um usuário utilizando o token de um provedor externo (Google, Facebook, Microsoft).
*     tags:
*       - Autenticação
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             properties:
*               provider:
*                 type: string
*                 description: Nome do provedor externo (google, facebook, microsoft).
*                 example: "google"
*               inviteId:
*                 type: string
*                 description: ID do convite (opcional).
*                 example: "invite123"
*               email:
*                 type: string
*                 description: Email do usuário.
*                 example: "user@example.com"
*               nome:
*                 type: string
*                 description: Nome do usuário.
*                 example: "John Doe"
*     responses:
*       200:
*         description: Registro com provedor bem-sucedido.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/AuthResponse'
*       500:
*         description: Erro ao registrar com provedor.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
// router.route('/register-with-provider')
//  .post(authRateLimiter, authController.registerWithProvider);

 /**
* @swagger
* /auth/refresh-token:
*   post:
*     summary: Renova tokens de autenticação.
*     description: Verifica o refresh token e gera novos tokens de acesso e refresh.
*     tags:
*       - Autenticação
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             properties:
*               refreshToken:
*                 type: string
*                 description: Token de refresh do usuário.
*                 example: "refresh_token_example"
*     responses:
*       200:
*         description: Tokens renovados com sucesso.
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 accessToken:
*                   type: string
*                   description: Novo token de acesso.
*                   example: "eyJhbGciOiJIUzI1..."
*                 refreshToken:
*                   type: string
*                   description: Novo token de refresh.
*                   example: "eyJhbGciOiJIUzI1..."
*       400:
*         description: Refresh token inválido.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       500:
*         description: Erro ao renovar tokens.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
router.route('/refresh-token')
 .post(rateLimiter, verifyToken, validate(authSchemas.schemas['refresh-token']), authController.refreshToken);

// Alias para compatibilidade com frontend que chama /refresh
router.route('/refresh')
 .post(rateLimiter, verifyToken, validate(authSchemas.schemas['refresh-token']), authController.refreshToken);

 /**
* @swagger
* /auth/token:
*   get:
*     summary: Gera novos tokens de acesso e refresh.
*     description: Endpoint para gerar tokens JWT de acesso e refresh para um usuário autenticado.
*     tags:
*       - Autenticação
*     security:
*       - bearerAuth: []
*     responses:
*       200:
*         description: Tokens gerados com sucesso.
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 accessToken:
*                   type: string
*                   description: Token JWT de acesso.
*                   example: "eyJhbGciOiJIUzI1..."
*                 refreshToken:
*                   type: string
*                   description: Token JWT de refresh.
*                   example: "eyJhbGciOiJIUzI1..."
*       500:
*         description: Erro ao gerar tokens.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
// Autenticação/Login com análise de device
router.route('/token')
 .post(
   validate(authSchemas.schemas['token']), // BUG FIX: Validação de input
   deviceCheck,                         // Análise de dispositivo  
   velocityCheck('login'),              // Verificação de velocity de login
   (req, res, next) => {
     // Logic de segurança para login
     const deviceAnalysis = req.securityContext?.device;
     const velocityAnalysis = req.securityContext?.velocity;
     
     if (!deviceAnalysis?.isKnownDevice && deviceAnalysis?.riskScore > 0.7) {
       // Dispositivo novo com alto risco
       logger.warn('Login from high-risk new device', {
         deviceId: deviceAnalysis.deviceId,
         riskScore: deviceAnalysis.riskScore,
         ip: req.ip
       });
       
       req.requireEmailVerification = true;
       req.securityNotice = 'New device detected. Email verification will be required.';
     }
     
     if (velocityAnalysis?.riskLevel === 'HIGH') {
       logger.warn('High velocity login attempts', {
         ip: req.ip,
         attempts: velocityAnalysis.actions,
         riskScore: velocityAnalysis.riskScore
       });
       
       return res.status(429).json({
         error: 'Too many login attempts. Please try again later.',
         retryAfter: 900, // 15 minutes
         riskLevel: velocityAnalysis.riskLevel
       });
     }
     
     next();
   },
   rateLimiter, 
   firstAccess, 
   securityLogging,
   authController.getToken
 );

 /**
* @swagger
* /auth/resend-verification-email:
*   post:
*     summary: Reenvia email de verificação.
*     description: Reenvia o email de verificação para o endereço de email associado ao usuário.
*     tags:
*       - Autenticação
*     responses:
*       200:
*         description: Email de verificação reenviado com sucesso.
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 message:
*                   type: string
*                   description: Mensagem de sucesso.
*                   example: "Email de verificação reenviado."
*       500:
*         description: Erro ao reenviar email de verificação.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
// Verificação de email via OTP customizado (Resend API, template branded)
// Substitui sendEmailVerification nativo do Firebase
router.post('/send-email-verification',
  rateLimiter,
  verifyToken,
  authController.sendEmailVerificationOtp
);

router.post('/confirm-email-verification',
  authRateLimiter,
  verifyToken,
  authController.confirmEmailVerification
);

/**
* @swagger
* /auth/me:
*   get:
*     summary: Obter dados do usuário atual.
*     description: Recupera as informações do usuário autenticado usando o token JWT.
*     tags:
*       - Autenticação
*     security:
*       - bearerAuth: []
*     responses:
*       200:
*         description: Dados do usuário recuperados com sucesso.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/User'
*       401:
*         description: Não autorizado. Token ausente ou inválido.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       500:
*         description: Erro ao recuperar dados do usuário.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*/
router.route('/me')
 .get(rateLimiter, verifyToken, authController.getCurrentUser);

// Validação do OTP de step-up para login de alto risco
// Recebe: { challengeToken, code } — sem verifyToken (usuário ainda não tem JWT)
router.post('/verify-otp-challenge',
  authRateLimiter,
  authController.verifyOtpChallenge
);

// Marcar telefone como verificado após Firebase Phone Auth no frontend
// Requer autenticação (verifyToken) — o usuário já tem JWT
router.patch('/verify-phone',
  rateLimiter,
  verifyToken,
  authController.verifyPhone
);

// ═══════════════════════════════════════════════════════════════════════════════
// Account Recovery via Phone — Endpoints PÚBLICOS (usuário está sem acesso)
// Todos protegidos apenas por rate limiter (sem verifyToken)
// ═══════════════════════════════════════════════════════════════════════════════

// Busca se telefone está registrado e verificado
router.post('/recovery/lookup-phone',
  authRateLimiter,
  authController.lookupPhoneForRecovery
);

// Verifica ownership via Firebase Phone Auth + gera recovery ticket
router.post('/recovery/verify-phone',
  authRateLimiter,
  authController.verifyPhoneForRecovery
);

// Altera email da conta (protegido por recovery ticket)
router.post('/recovery/change-email',
  authRateLimiter,
  authController.recoveryChangeEmail
);

// Envia link de redefinição de senha (protegido por recovery ticket)
router.post('/recovery/send-reset',
  authRateLimiter,
  authController.recoverySendReset
);

// ═══════════════════════════════════════════════════════════════════════════════
// Session Management — list, revoke single, revoke all others
// ═══════════════════════════════════════════════════════════════════════════════

// List all active sessions for the authenticated user
router.get('/sessions',
  rateLimiter,
  verifyToken,
  authController.getSessions
);

// Revoke a specific session by ID
router.delete('/sessions/:sessionId',
  rateLimiter,
  verifyToken,
  authController.revokeSession
);

// Revoke all sessions except current (header x-session-id)
router.delete('/sessions',
  rateLimiter,
  verifyToken,
  authController.revokeAllSessions
);

// ═══════════════════════════════════════════════════════════════════════════════
// MFA — Autenticacao em dois fatores (2FA)
// ═══════════════════════════════════════════════════════════════════════════════

// Configura TOTP (gera QR code) — requer autenticacao
router.post('/mfa/setup-totp',
  rateLimiter,
  verifyToken,
  authController.setupTOTP
);

// Confirma TOTP (codigo do app) — requer autenticacao
router.post('/mfa/confirm-totp',
  rateLimiter,
  verifyToken,
  authController.confirmTOTP
);

// Ativa 2FA via SMS — requer autenticacao
router.post('/mfa/enable-sms',
  rateLimiter,
  verifyToken,
  authController.enableSMS2FA
);

// Desativa MFA — requer autenticacao
router.post('/mfa/disable',
  rateLimiter,
  verifyToken,
  authController.disableMFA
);

// Status do MFA — requer autenticacao
router.get('/mfa/status',
  rateLimiter,
  verifyToken,
  authController.getMFAStatus
);

// Verificar codigo MFA durante login — PUBLICO (rate limited)
router.post('/mfa/verify',
  authRateLimiter,
  authController.verifyMFA
);

// Enviar SMS OTP para MFA — PUBLICO (rate limited)
router.post('/mfa/send-sms',
  authRateLimiter,
  authController.sendMFASms
);

// ═══════════════════════════════════════════════════════════════════════════════
// Passwordless Auth — Access Code + Magic Link (AUTH-PL-002)
// Endpoints PÚBLICOS (usuário ainda não tem JWT)
// ═══════════════════════════════════════════════════════════════════════════════

// Enviar código de acesso temporário (8-char, 24h) por email
router.post('/passwordless/send-code',
  authRateLimiter,
  authController.sendAccessCode
);

// Verificar código e fazer login
router.post('/passwordless/verify-code',
  authRateLimiter,
  authController.verifyAccessCode
);

// Enviar magic link por email (15min)
router.post('/passwordless/send-link',
  authRateLimiter,
  authController.sendMagicLink
);

// Verificar magic link token e fazer login
router.post('/passwordless/verify-link',
  authRateLimiter,
  authController.verifyMagicLink
);

// Registro passwordless — cria conta sem senha (AUTH-PL-005)
// Sem firstAccess: não há Firebase token ainda (user criado server-side).
// Convite validado é a prova de identidade — ja3Hash opcional.
router.post('/passwordless/register',
  authRateLimiter,
  authController.passwordlessRegister
);

// ═══════════════════════════════════════════════════════════════════════════════
// WebAuthn / Passkeys — FIDO2 (AUTH-PL-003)
// ═══════════════════════════════════════════════════════════════════════════════
const webauthnController = require('../controllers/webauthnController');

// Registro de passkey (requer autenticação — usuário logado adiciona passkey)
router.post('/webauthn/register-options',
  rateLimiter,
  verifyToken,
  webauthnController.getRegistrationOptions
);

router.post('/webauthn/register-verify',
  rateLimiter,
  verifyToken,
  webauthnController.verifyRegistration
);

// Autenticação por passkey (público — login sem senha)
router.post('/webauthn/auth-options',
  authRateLimiter,
  webauthnController.getAuthenticationOptions
);

router.post('/webauthn/auth-verify',
  authRateLimiter,
  webauthnController.verifyAuthentication
);

// Gerenciamento de passkeys (requer autenticação)
router.get('/webauthn/credentials',
  rateLimiter,
  verifyToken,
  webauthnController.listCredentials
);

router.delete('/webauthn/credentials/:credentialId',
  rateLimiter,
  verifyToken,
  webauthnController.deleteCredential
);

module.exports = router;