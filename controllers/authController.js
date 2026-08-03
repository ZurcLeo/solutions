/**
 * @fileoverview Controller de autenticação - gerencia login, registro e sessões de usuários
 * @module controllers/authController
 * @requires firebaseAdmin
 * @requires jsonwebtoken
 * @requires ../services/authService
 * @requires ../services/inviteService
 * @requires ../services/userService
 * @requires ../logger
 * @requires ../models/User
 */

// controllers/authController.js
const { getAuth } = require('../firebaseAdmin');
const jwt = require('jsonwebtoken');
const authService = require('../services/authService');
const inviteService = require('../services/inviteService');
const caixinhaInviteService = require('../services/CaixinhaInviteService');
const userService = require('../services/userService');
const userRoleService = require('../services/userRoleService');
const supabaseSyncService = require('../services/supabaseSyncService');
const { generateToken, generateRefreshToken } = require('../services/authService');
const { logger } = require('../logger');
const User = require('../models/User');
const { isLocallyBlacklisted } = require('../utils/securityUtils');
const SecurityTicketService = require('../services/SecurityTicketService');
const emailService = require('../services/emailService');
const gamificationService = require('../services/gamificationService');
const mfaService = require('../services/mfaService');
const sessionService = require('../services/sessionService');
const accessCodeService = require('../services/accessCodeService');
const magicLinkService = require('../services/magicLinkService');
const crypto = require('crypto');

/**
 * Verifica o estado atual da sessão do usuário
 * @async
 * @function checkSession
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Status da autenticação e dados do usuário
 * @description Verifica tokens de acesso em cookies ou headers, valida na blacklist e retorna estado da sessão
 */
exports.checkSession = async (req, res) => {
  // Extrair token de acesso dos cookies ou headers
  let accessToken;
  const authHeader = req.headers['authorization'];
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
  } else if (req.cookies && req.cookies.authorization) {
    const cookieToken = req.cookies.authorization;
    if (cookieToken.startsWith('Bearer ')) {
      accessToken = cookieToken.substring(7);
    } else {
      accessToken = cookieToken;
    }
  }

  // Se não houver token, retornar não autenticado
  if (!accessToken) {
    return res.status(200).json({
      isAuthenticated: false,
      message: 'Sessão não encontrada'
    });
  }

  try {
    // Verificar se o token está na blacklist
    const isBlacklisted = await isTokenBlacklisted(accessToken);
    if (isBlacklisted) {
      return res.status(200).json({
        isAuthenticated: false,
        message: 'Sessão inválida'
      });
    }
    
    // Verificar e decodificar o token
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    const userId = decoded.uid;
    
    // Buscar usuário no banco
    const user = await User.getById(userId);
    
    // Verificar se o usuário foi encontrado
    if (!user) {
      return res.status(200).json({
        isAuthenticated: false,
        message: 'Usuário não encontrado'
      });
    }

    // BUG FIX: Anexar as roles ao usuário para o frontend
    const roles = await userRoleService.getUserRoles(userId);
    user.roles = roles;
    
    // Verificar se o registro está completo
    const isFirstAccess = !user.registrationStage || user.registrationStage === 'initial';
    
    // Verificar se o token está próximo de expirar
    const tokenExpiresAt = decoded.exp * 1000; // Converter para milissegundos
    const currentTime = Date.now();
    const timeToExpiry = tokenExpiresAt - currentTime;
    const shouldRefresh = timeToExpiry < 300000; // 5 minutos
    
    // Se o token estiver próximo de expirar, gerar novos tokens
    let tokens = null;
    if (shouldRefresh) {
      tokens = authService.generateToken({
        uid: userId,
        email: user.email,
        roles: roles
      });
      
      // Atualizar cookies com novos tokens
      res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
      
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
    }
    
    return res.status(200).json({
      isAuthenticated: true,
      isFirstAccess: isFirstAccess,
      user: user,
      sessionRefreshed: !!tokens,
      tokens: tokens
    });
  } catch (error) {
    // Se o erro for de token expirado, tentar usar refresh token
    if (error.name === 'TokenExpiredError' && req.cookies && req.cookies.refreshToken) {
      try {
        // Verificar refresh token
        const refreshToken = req.cookies.refreshToken;
        const newTokens = await authService.verifyAndGenerateNewToken(refreshToken);
        
        // Buscar usuário com o ID do token renovado
        const decoded = jwt.verify(newTokens.accessToken, process.env.JWT_SECRET);
        const userId = decoded.uid;
        const user = await User.getById(userId);
        
        // Atualizar cookies
        res.cookie('authorization', `Bearer ${newTokens.accessToken}`, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict'
        });
        
        res.cookie('refreshToken', newTokens.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict'
        });
        
        return res.status(200).json({
          isAuthenticated: true,
          isFirstAccess: !user.registrationStage || user.registrationStage === 'initial',
          user: user,
          sessionRefreshed: true,
          tokens: newTokens
        });
      } catch (refreshError) {
        // Se falhar a renovação, retornar não autenticado
        return res.status(200).json({
          isAuthenticated: false,
          message: 'Sessão expirada',
          requireRelogin: true
        });
      }
    }
    
    // Para qualquer outro erro, retornar não autenticado
    logger.error('Erro ao verificar sessão', {
      error: error.message
    });
    
    return res.status(200).json({
      isAuthenticated: false,
      message: 'Sessão inválida',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Gera token JWT a partir de token Firebase
 * @async
 * @function getToken
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Corpo da requisição
 * @param {string} req.body.firebaseToken - Token do Firebase para validação
 * @param {boolean} [req.isFirstAccess] - Flag indicando primeiro acesso (definida por middleware)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Token JWT e dados do usuário
 * @description Verifica token Firebase e retorna JWT customizado para autenticação na API
 */
exports.getToken = async (req, res) => {
  try {
    const { firebaseToken } = req.body;

    if (!firebaseToken) {
      return res.status(400).json({
        success: false,
        message: 'Token do Firebase não fornecido'
      });
    }

    // AUTH-PL-006: Verificar se login por senha está desabilitado após cutoff
    const passwordTransitionService = require('../services/passwordTransitionService');
    const deprecation = passwordTransitionService.getPasswordDeprecationStatus();
    if (deprecation.disabled) {
      // Verificar se o login veio do provider "password" (Firebase sign_in_provider)
      // Somente bloquear logins com senha — OAuth e custom tokens continuam permitidos
      const signInProvider = req.body.signInProvider || req.headers['x-sign-in-provider'];
      if (signInProvider === 'password') {
        return res.status(410).json({
          success: false,
          code: 'PASSWORD_LOGIN_DISABLED',
          message: 'Login com senha foi desativado. Use biometria, link por email ou código de acesso.',
          cutoffDate: deprecation.cutoffDate,
        });
      }
    }

    // Verificar o token do Firebase
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(firebaseToken);
    const userId = decodedToken.uid;

    // SEC-2: Bloquear usuários na blacklist local antes de emitir JWT
    if (isLocallyBlacklisted(userId)) {
      logger.warn('Login bloqueado: userId na blacklist local', {
        service: 'authController', function: 'getToken', userId
      });
      return res.status(401).json({ error: 'TOKEN_REVOKED' });
    }

    // Verificar se é o primeiro acesso (usando flag definida pelo middleware)
    const isFirstAccess = req.isFirstAccess || false;
    
    // INVITE GATE: primeiro acesso via social login sem registro por convite
    // Bloqueia acesso mas NÃO deleta o user do Firebase Auth — a sync com Supabase
    // é assíncrona e deleteUser() causava race condition (user deletado antes da sync completar).
    // O user fica no Firebase Auth sem perfil no Supabase, portanto sem acesso à plataforma.
    if (isFirstAccess) {
      logger.warn('[authController] INVITE GATE: primeiro acesso sem registro bloqueado (user mantido no Firebase)', {
        service: 'authController', function: 'getToken', userId,
      });
      return res.status(403).json({
        success: false,
        code: 'INVITE_REQUIRED',
        message: 'Registro requer convite. Use o link de convite para criar sua conta.',
      });
    }

    // Buscar dados do usuário completo do banco
    const user = await User.getById(userId);
    
    // ── Step-Up OTP: dispositivo novo ou velocidade suspeita ─────────────────
    // req.requireEmailVerification é setado pelo smartSecurity middleware quando
    // deviceCheck detecta risk > 0.7 em dispositivo desconhecido.
    if (req.requireEmailVerification === true) {
      const userEmail = decodedToken.email;
      const userName  = decodedToken.name || (userEmail && userEmail.split('@')[0]) || 'usuário';
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

      const { code, expiresIn } = await SecurityTicketService.generateTicket(userId, 'login', {
        ipAddress,
        metadata: { email: userEmail, reason: 'new_device_high_risk' },
      });

      // Envia OTP por e-mail — código nunca vai para a resposta
      if (!userEmail) {
        logger.error('getToken: step-up OTP exigido mas usuário sem email', { userId });
        return res.status(400).json({
          success: false,
          message: 'Nenhum email cadastrado para envio do código de verificação.',
        });
      }

      const otpResult = await emailService.sendOTP({ to: userEmail, userName, code, type: 'login', expiresIn });

      if (!otpResult.success) {
        logger.error('getToken: falha ao enviar OTP', {
          service: 'authController', userId, error: otpResult.error,
        });

        if (otpResult.error === 'otp_rate_limit_exceeded') {
          return res.status(429).json({
            success: false,
            message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
            retryAfterSeconds: otpResult.retryAfterSeconds || 900,
          });
        }

        if (otpResult.error === 'recipient_suppressed') {
          return res.status(422).json({
            success: false,
            message: 'Não conseguimos enviar para este email. Entre em contato com o suporte.',
          });
        }

        return res.status(500).json({
          success: false,
          message: 'Erro ao enviar código de verificação. Tente novamente.',
        });
      }

      // challengeToken: JWT de curta duração que identifica o usuário sem expor o UID
      const challengeToken = jwt.sign(
        { uid: userId, purpose: 'otp_challenge', type: 'login' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );

      logger.warn('getToken: step-up OTP exigido (novo dispositivo/alto risco)', {
        service: 'authController', userId, ip: ipAddress,
      });

      return res.status(202).json({
        requiresOtp:    true,
        challengeToken,
        expiresIn,
        message:        'Verificação adicional necessária. Código enviado para o seu e-mail.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── MFA: se o usuario tem 2FA ativo, exigir verificacao antes de emitir JWT ──
    if (user && user.mfaEnabled) {
      // challengeToken de curta duracao identifica o usuario no passo de verificacao MFA
      const mfaChallengeToken = jwt.sign(
        { uid: userId, purpose: 'mfa_challenge' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );

      logger.info('getToken: MFA requerido', {
        service: 'authController', userId, mfaMethod: user.mfaMethod,
      });

      return res.status(200).json({
        success: true,
        mfaRequired: true,
        mfaMethod: user.mfaMethod, // 'sms', 'totp', 'both'
        challengeToken: mfaChallengeToken,
        hasBackupCodes: (user.backupCodesCount || 0) > 0,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Buscar roles do usuário (fonte de verdade: Supabase user_roles)
    const roles = await userRoleService.getUserRoles(userId);

    // Garantir que o user object reflita as roles do Supabase (e não o campo legado do Firestore)
    if (user) user.roles = roles;

    // Gerar tokens JWT
    const tokens = authService.generateToken({
      uid: userId,
      email: decodedToken.email,
      roles: roles,
      username: user?.username || null
    });

    // Sincronizar silenciosamente com Supabase (Migração)
    supabaseSyncService.syncUserToSupabase(user).catch(err =>
      logger.error('Erro na sincronização pós-login', { userId, error: err.message })
    );

    // [GAME-COV-001] Gamificação: acesso diário + email verificado (idempotente — RPCs ignoram se já completo)
    gamificationService.triggerEvent('daily_access', userId).catch(() => {});
    if (decodedToken.email_verified) {
      gamificationService.triggerEvent('email_verified', userId).catch(() => {});
    }

    // Create session record (fire-and-forget safe, errors are logged)
    let sessionId = null;
    try {
      const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
      sessionId = await sessionService.createSession(userId, tokens.refreshToken, deviceInfo);
      if (sessionId) {
        await sessionService.markCurrentSession(userId, sessionId);
      }
    } catch (sessErr) {
      logger.error('getToken: falha ao criar sessão', { userId, error: sessErr.message });
    }

    // Configurar cookies
    res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    // AUTH-PL-006: Incluir flag de deprecação se senha ainda funciona mas cutoff definido
    const responsePayload = {
      success: true,
      isAuthenticated: true,
      isFirstAccess: isFirstAccess,
      user: user,
      tokens: tokens,
      sessionId: sessionId,
    };

    if (deprecation.deprecated) {
      responsePayload.passwordDeprecated = true;
      responsePayload.passwordCutoffDate = deprecation.cutoffDate;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    logger.error('Erro ao gerar token', {
      error: error.message
    });

    return res.status(401).json({
      success: false,
      message: 'Falha na autenticação',
      error: error.message
    });
  }
};

/**
 * Verifica o desafio OTP emitido em login de alto risco e emite o JWT definitivo.
 * Não requer verifyToken — o usuário ainda não possui JWT.
 * Body: { challengeToken, code }
 */
exports.verifyOtpChallenge = async (req, res) => {
  const { challengeToken, code } = req.body;

  if (!challengeToken || !code) {
    return res.status(400).json({ success: false, message: 'challengeToken e code são obrigatórios.' });
  }

  if (!/^\d{6}$/.test(String(code).trim())) {
    return res.status(400).json({ success: false, message: 'Código inválido. Deve conter 6 dígitos.' });
  }

  try {
    // 1. Decodifica e valida o challengeToken (JWT de curta duração)
    let payload;
    try {
      payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Desafio expirado ou inválido. Faça login novamente.' });
    }

    if (payload.purpose !== 'otp_challenge' || payload.type !== 'login') {
      return res.status(401).json({ success: false, message: 'Token de desafio inválido.' });
    }

    const userId = payload.uid;

    // 2. Bloquear usuários na blacklist
    if (isLocallyBlacklisted(userId)) {
      return res.status(401).json({ error: 'TOKEN_REVOKED' });
    }

    // 3. Valida o OTP — marca ticket como 'used' no Supabase
    await SecurityTicketService.validateTicket(userId, 'login', String(code).trim());

    // 4. Buscar dados completos para gerar JWT
    const user  = await User.getById(userId);
    const roles = await userRoleService.getUserRoles(userId);

    const tokens = authService.generateToken({
      uid:      userId,
      email:    user?.email,
      roles,
      username: user?.username || null,
    });

    // [GAME-COV-001] Gamificação: acesso diário via login step-up
    gamificationService.triggerEvent('daily_access', userId).catch(() => {});

    // Create session record (fire-and-forget safe)
    let sessionId = null;
    try {
      const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
      sessionId = await sessionService.createSession(userId, tokens.refreshToken, deviceInfo);
      if (sessionId) await sessionService.markCurrentSession(userId, sessionId);
    } catch (sessErr) {
      logger.error('verifyOtpChallenge: falha ao criar sessão', { userId, error: sessErr.message });
    }

    res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    logger.info('verifyOtpChallenge: autenticação step-up concluída', {
      service: 'authController', userId,
    });

    return res.status(200).json({
      success:         true,
      isAuthenticated: true,
      isFirstAccess:   false,
      user,
      tokens,
      sessionId,
    });

  } catch (err) {
    const isBruteForce = err.message?.includes('Muitas tentativas');
    logger.warn('verifyOtpChallenge: falha na verificação', {
      service: 'authController', error: err.message,
    });
    return res.status(isBruteForce ? 429 : 400).json({
      success: false,
      message: err.message || 'Código inválido ou expirado.',
    });
  }
};

/**
 * Registra novo usuário no sistema
 * @async
 * @function register
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Corpo da requisição
 * @param {string} req.body.firebaseToken - Token do Firebase
 * @param {string} [req.body.inviteId] - ID do convite (opcional)
 * @param {Object} req.body.profileData - Dados do perfil do usuário
 * @param {string} [req.ja3Hash] - Hash JA3 da requisição (definido por middleware)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados do usuário registrado e tokens
 * @description Cria conta de usuário usando Firebase e armazena dados no banco
 */
exports.register = async (req, res) => {
  const auth = getAuth();
  const ja3Hash = req.ja3Hash;
  const { firebaseToken: bodyToken, inviteId, profileData, nome: rawNome } = req.body;
  // Frontend envia o ID token no header Authorization; fallback para o body
  const firebaseToken = bodyToken
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  // Validação server-side do nome: allowlist — letras, espaços, acentos, hifens (2-120 chars)
  const nome = typeof rawNome === 'string'
    ? rawNome.trim().substring(0, 120)
    : undefined;
  if (nome && (nome.length < 2 || !/^[\p{L}\s'.\-]+$/u.test(nome))) {
    return res.status(400).json({ success: false, message: 'Nome inválido. Use apenas letras, espaços e acentos.' });
  }

  // Pré-validação: ja3Hash é marcador de segurança obrigatório
  if (!ja3Hash) {
    logger.warn('Registro bloqueado: ja3Hash ausente', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      hasFingerprint: !!req.headers['x-browser-fingerprint'],
      hasBodyToken: !!bodyToken,
      hasAuthHeader: !!(req.headers.authorization)
    });
    return res.status(400).json({
      success: false,
      code: 'FINGERPRINT_REQUIRED',
      message: 'Fingerprint de segurança não disponível. Atualize o aplicativo e tente novamente.'
    });
  }

  let userId = null;

  try {
    if (!firebaseToken) {
      return res.status(401).json({ success: false, message: 'Token de autenticação não fornecido' });
    }

    // 1. Verificar o token do Firebase
    const decodedToken = await auth.verifyIdToken(firebaseToken);
    userId = decodedToken.uid;

    // 3. Criar ou atualizar perfil do usuário
    const userData = {
      uid: userId,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      ja3Hash,
      nome: nome || decodedToken.name || decodedToken.email?.split('@')[0],  // fallback seguro
      ...profileData,   // sobrescreve nome se profileData tiver um nome melhor
      dataCriacao: Date.now()
    };
    
    const user = await userService.addUser(userData);
    
    // Sincronizar com Supabase de forma SÍNCRONA no registro — o user DEVE existir
    // no Supabase ANTES de qualquer chamada a getToken(), caso contrário o middleware
    // firstAccess detecta "primeiro acesso" e bloqueia o login (INVITE GATE race condition).
    try {
      await supabaseSyncService.syncUserToSupabase(user);
      logger.info('Sincronização pós-registro com Supabase concluída', { userId });
    } catch (syncErr) {
      // Logar erro mas NÃO falhar o registro — user já existe no Firebase Auth
      // e poderá ser sincronizado em login subsequente via getToken()
      logger.error('Erro na sincronização pós-registro com Supabase (não-fatal)', {
        userId,
        error: syncErr.message,
      });
    }

    // [GAME-COV-001] Gamificação: novo usuário criado
    gamificationService.triggerEvent('user_created', userId).catch(() => {});

    // 2. Verificar e invalidar o convite (se fornecido)
    if (inviteId) {
      const inviteResult = await inviteService.invalidateInvite(inviteId, userId);

      // Bridge: se o convite de plataforma veio de um convite de caixinha, vincular o usuário
      if (inviteResult.caxinhaInviteId && inviteResult.caixinhaId) {
        await caixinhaInviteService.linkToRegisteredUser(
          inviteResult.caxinhaInviteId,
          inviteResult.caixinhaId,
          userId
        );
      }
    }

    // [BIZ-004] Processar business invites pendentes para este email (porta de entrada D6)
    const businessInviteService = require('../services/businessInviteService');
    businessInviteService.processRegistrationInvites(decodedToken.email, userId)
      .catch(err => logger.error('processRegistrationInvites falhou', { error: err.message, userId }));

    // Buscar roles do usuário
    const roles = await userRoleService.getUserRoles(userId);
    user.roles = roles; // BUG FIX: Anexar roles ao usuário para o frontend

    // 4. Gerar token JWT da aplicação
    const tokens = authService.generateToken({
      uid: userId,
      email: decodedToken.email,
      roles: roles
    });
    
    // 5. Create session record (fire-and-forget safe)
    let sessionId = null;
    try {
      const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
      sessionId = await sessionService.createSession(userId, tokens.refreshToken, deviceInfo);
      if (sessionId) await sessionService.markCurrentSession(userId, sessionId);
    } catch (sessErr) {
      logger.error('register: falha ao criar sessão', { userId, error: sessErr.message });
    }

    // 6. Definir cookies de autenticação
    res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    return res.status(200).json({
      success: true,
      message: 'Registro concluído com sucesso',
      isAuthenticated: true,
      isFirstAccess: true,
      user,
      tokens,
      sessionId
    });
  } catch (error) {
    logger.error('Erro no registro', {
      error: error.message,
      inviteId,
      profileData
    });

    // Cleanup: deletar Firebase Auth user órfão para evitar conta presa
    if (userId) {
      try {
        await auth.deleteUser(userId);
        logger.info('Firebase Auth user órfão deletado após falha no registro', { userId });
      } catch (cleanupErr) {
        logger.error('Falha ao limpar Firebase Auth user órfão', {
          userId,
          error: cleanupErr.message
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Erro ao processar registro',
      error: error.message
    });
  }
};

// exports.registerWithEmail = async (req, res) => {
//     const { uid, email, nome, inviteId } = req.body;

//     if (!uid || !email || !nome || !inviteId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Dados incompletos para registro com convite'
//       });
//     }

//     const validationResult = await inviteService.checkInvite(inviteId, email);
    
//     if (!validationResult.valid) {
//       return res.status(400).json({
//         success: false,
//         message: validationResult.message || 'Convite inválido'
//       });
//     }

//     await inviteService.invalidateInvite(inviteId, uid);


//   try {
//     const response = await authService.registerWithEmail(email, password, inviteId);
//     res.status(200).json(response);
//   } catch (error) {
//     logger.error('Erro ao criar conta', { service: 'authController', function: 'registerWithEmail', error: error.message });
//     res.status(500).json({ message: 'Erro ao criar conta', error: error.message });
//   }
// };

/**
 * Efetua logout do usuário
 * @async
 * @function logout
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.headers - Headers da requisição
 * @param {string} [req.headers.authorization] - Token Bearer no header
 * @param {Object} [req.cookies] - Cookies da requisição
 * @param {string} [req.cookies.authorization] - Token de autorização no cookie
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação do logout
 * @description Adiciona token à blacklist e limpa cookies de autenticação
 */
exports.logout = async (req, res) => {
  // Captura do token do cabeçalho Authorization ou dos cookies
  let idToken = null;

  // Verifica se o token está no header 'authorization'
  const authHeader = req.headers['authorization'] || req.cookies['authorization'];
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    idToken = authHeader.split(' ')[1];  // Extrai o token do header
  } else if (req.cookies['authorization']) {
    idToken = req.cookies['authorization'];  // Extrai o token dos cookies, se presente
  }

  // Log de informação sobre o processo de logout
  logger.info('Requisição de logout recebida', {
    service: 'authController',
    function: 'logout',
    idToken // Pode ser útil para depuração, mas certifique-se de não expor o token sensível em logs de produção
  });

  // Se o token não foi encontrado, retorna erro
  if (!idToken) {
    logger.warn('Token não encontrado na requisição', {
      service: 'authController',
      function: 'logout'
    });
    return res.status(400).json({ message: 'Token not found in request' });
  }

  try {
    // Chama o serviço de logout, passando o token
    await authService.logout(idToken);
    logger.info('Logout realizado com sucesso e token blacklisted', {
      service: 'authController',
      function: 'logout',
      idToken
    });
    res.status(200).json({ message: 'Logout successful and token blacklisted' });
  } catch (error) {
    logger.error('Falha ao tentar blacklist o token', {
      service: 'authController',
      function: 'logout',
      error: error.message,
      idToken
    });
    res.status(500).json({ message: 'Failed to blacklist token', error: error.message });
  }
};


// exports.registerWithProvider = async (req, res) => {
//   const { provider, inviteId, registrationToken } = req.body;

//   try {
//     const response = await authService.registerWithProvider(provider, inviteId);
//     res.status(200).json(response);
//   } catch (error) {
//     logger.error('Erro no registro com provedor', { service: 'authController', function: 'registerWithProvider', error: error.message });
//     res.status(500).json({ message: 'Erro no registro com provedor', error: error.message });
//   }
// };
/**
 * Reenvia email de verificação para o usuário
 * @async
 * @function resendVerificationEmail
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resultado do reenvio do email
 * @description Solicita novo envio de email de verificação através do authService
 */
/**
 * Envia OTP de verificação de email via nosso emailService (Resend).
 * Substitui o sendEmailVerification nativo do Firebase — permite template branded.
 * Requer autenticação (verifyToken).
 */
exports.sendEmailVerificationOtp = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuário não autenticado.' });
    }

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    if (!user.email) {
      return res.status(400).json({ success: false, message: 'Nenhum email cadastrado.' });
    }

    // Gera OTP via SecurityTicketService (HMAC-SHA256, anti-brute-force)
    const { code, expiresIn } = await SecurityTicketService.generateTicket(
      userId,
      'email_verify',
      {
        ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        metadata: { email: user.email },
      }
    );

    // Envia via nosso emailService (Resend API, template branded)
    const emailResult = await emailService.sendOTP({
      to: user.email,
      userName: user.nome || user.full_name || user.username || 'usuário',
      code,
      type: 'email_verify',
      expiresIn,
    });

    if (!emailResult.success) {
      logger.error('sendEmailVerificationOtp: falha ao enviar email', {
        service: 'authController', userId, error: emailResult.error,
      });

      if (emailResult.error === 'otp_rate_limit_exceeded') {
        return res.status(429).json({
          success: false,
          message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
          retryAfterSeconds: emailResult.retryAfterSeconds || 900,
        });
      }

      if (emailResult.error === 'recipient_suppressed') {
        return res.status(422).json({
          success: false,
          message: 'Não conseguimos enviar para este email. Entre em contato com o suporte.',
        });
      }

      return res.status(500).json({ success: false, message: 'Erro ao enviar email de verificação.' });
    }

    logger.info('sendEmailVerificationOtp: OTP enviado', {
      service: 'authController', userId, messageId: emailResult.messageId,
    });

    return res.status(200).json({
      success: true,
      message: 'Código de verificação enviado para seu email.',
      expiresIn,
    });
  } catch (error) {
    logger.error(`sendEmailVerificationOtp: ${error.message}`, {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao enviar email de verificação.' });
  }
};

/**
 * Confirma o OTP de verificação de email.
 * Marca emailVerified = true no Supabase e no Firebase Auth.
 * Requer autenticação (verifyToken).
 */
exports.confirmEmailVerification = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuário não autenticado.' });
    }

    const { code } = req.body;
    if (!code || !/^\d{6}$/.test(String(code).trim())) {
      return res.status(400).json({ success: false, message: 'Código inválido. Deve conter 6 dígitos.' });
    }

    // Valida OTP (marca ticket como 'used', anti-brute-force)
    await SecurityTicketService.validateTicket(userId, 'email_verify', String(code).trim());

    // Marca emailVerified no Supabase
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase
        .from('users')
        .update({ email_verified: true, email_verified_at: new Date().toISOString() })
        .eq('id', userId);
    }

    // Marca emailVerified no Firebase Auth
    try {
      const auth = getAuth();
      await auth.updateUser(userId, { emailVerified: true });
    } catch (fbErr) {
      logger.warn('confirmEmailVerification: falha ao atualizar Firebase Auth', {
        service: 'authController', userId, error: fbErr.message,
      });
      // Não bloqueia — Supabase é fonte de verdade
    }

    logger.info('confirmEmailVerification: email verificado com sucesso', {
      service: 'authController', userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Email verificado com sucesso!',
    });
  } catch (error) {
    const isBruteForce = error.message?.includes('Muitas tentativas');
    logger.warn('confirmEmailVerification: falha na verificação', {
      service: 'authController', error: error.message,
    });
    return res.status(isBruteForce ? 429 : 400).json({
      success: false,
      message: error.message || 'Código inválido ou expirado.',
    });
  }
};

/**
 * Obtém dados do usuário autenticado atual
 * @async
 * @function getCurrentUser
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.user - Dados do usuário autenticado (definido por middleware)
 * @param {string} req.user.uid - ID único do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados completos do usuário autenticado
 * @description Retorna informações do usuário baseado no token JWT decodificado
 */
exports.getCurrentUser = async (req, res) => {
  try {
    // O userId já deve vir do token decodificado, não precisa ser da rota
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userId = req.user.uid; // Obtendo diretamente do token, sem usar params

    // O código abaixo verifica se a rota é '/me', mas isso não é necessário, pois já sabemos que é o usuário autenticado
    logger.info('Requisição para obter usuário autenticado', { service: 'userController', function: 'getCurrentUser', userId });
    const user = await authService.getCurrentUser(userId);
    if (user) {
      return res.status(200).json(user);
    } else {
      logger.warn('Usuário não encontrado', { service: 'userController', function: 'getCurrentUser', userId });
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
  } catch (error) {
    logger.error('Erro ao obter usuário por ID', { service: 'userController', function: 'getCurrentUser', error: error.message });
    return res.status(500).json({ message: 'Erro ao obter usuário' });
  }
};

/**
 * Renova token de acesso usando refresh token
 * @async
 * @function refreshToken
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} [req.body] - Corpo da requisição
 * @param {string} [req.body.refreshToken] - Token de refresh no corpo
 * @param {Object} [req.cookies] - Cookies da requisição
 * @param {string} [req.cookies.refreshToken] - Token de refresh no cookie
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Novos tokens de acesso e refresh
 * @description Valida refresh token e gera novos tokens de acesso
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body || req.cookies;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token é obrigatório' });
    }

    // Verificar se o refresh token é válido e gerar novos tokens
    const newTokens = await authService.verifyAndGenerateNewToken(refreshToken);

    if (!newTokens) {
      return res.status(403).json({ message: 'Token inválido ou expirado' });
    }

    // Touch session — update last_active_at (fire-and-forget)
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    sessionService.touchSession(tokenHash).catch(err =>
      logger.error('refreshToken: falha ao touch session', { error: err.message })
    );

    res.status(200).json({
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      message: 'Token renovado com sucesso',
    });

  } catch (error) {
    logger.error('Erro ao renovar token', { service: 'authController', function: 'refreshToken', error: error.message });
    res.status(500).json({ message: 'Erro ao renovar token', error: error.message });
  }
};

/**
 * Inicia processo de autenticação com provedores externos
 * @async
 * @function initiateAuth
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Corpo da requisição
 * @param {string} req.body.provider - Provedor de autenticação (google, apple, etc.)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados para iniciar autenticação (authUrl, state)
 * @description Prepara URL e estado para autenticação OAuth com provedor externo
 */
exports.initiateAuth = async (req, res) => {
  const { provider } = req.body;

  try {
    if (!provider) {
      return res.status(400).json({ message: 'Provider é obrigatório' });
    }

    const authData = await authService.initiateAuth(provider);
    res.status(200).json(authData); // { authUrl, state }
  } catch (error) {
    logger.error('Erro ao iniciar autenticação', { service: 'authController', function: 'initiateAuth', error: error.message });
    res.status(500).json({ message: 'Erro ao iniciar autenticação', error: error.message });
  }
};

/**
 * Inicia processo de registro com provedores externos
 * @async
 * @function initiateRegistration
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Corpo da requisição
 * @param {string} req.body.provider - Provedor de autenticação
 * @param {string} req.body.inviteId - ID do convite obrigatório
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados para iniciar registro (authUrl, state)
 * @description Prepara URL e estado para registro OAuth com validação de convite
 */
exports.initiateRegistration = async (req, res) => {
  const { provider, inviteId } = req.body;

  try {
    if (!provider || !inviteId) {
      return res.status(400).json({ message: 'Provider e inviteId são obrigatórios' });
    }

    const registrationData = await authService.initiateRegistration(provider, inviteId);
    res.status(200).json(registrationData); // { authUrl, state }
  } catch (error) {
    logger.error('Erro ao iniciar registro', { service: 'authController', function: 'initiateRegistration', error: error.message });
    res.status(500).json({ message: 'Erro ao iniciar registro', error: error.message });
  }
};

/**
 * Processa retorno da autenticação OAuth
 * @async
 * @function handleAuthCallback
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Corpo da requisição
 * @param {string} req.body.idToken - Token ID retornado pelo provedor
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object|Redirect>} Tokens e dados do usuário ou redirecionamento
 * @description Processa callback OAuth, valida tokens e autentica usuário
 */
exports.handleAuthCallback = async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  try {
    // Get the ID token from the request
    const { idToken } = req.body;
    
    if (!idToken) {
      throw new Error('No ID token provided');
    }

    const result = await authService.handleAuthCallback(idToken);

    if (isProduction) {
      // Set secure cookie for production
      res.cookie('accessToken', result.tokens.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: process.env.DOMAIN,
        maxAge: 3600000 // 1 hour
      });

      return res.redirect(`${process.env.FRONTEND_URL}/auth/callback`);
    }

    // Return tokens directly in development
    return res.status(200).json({
      success: true,
      tokens: result.tokens,
      user: result.user
    });

  } catch (error) {
    logger.error('Auth callback error:', {
      service: 'authController',
      function: 'handleAuthCallback',
      error: error.message
    });

    const errorUrl = isProduction
      ? `${process.env.FRONTEND_URL}/auth/error?message=${encodeURIComponent(error.message)}`
      : null;

    if (isProduction) {
      return res.redirect(errorUrl);
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Verifica token de redefinição de senha
 * @async
 * @function verifyResetToken
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.params - Parâmetros da URL
 * @param {string} req.params.token - Token de redefinição de senha
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Validação do token de reset
 * @description Verifica se token de redefinição de senha é válido e não expirou
 */
exports.verifyResetToken = async (req, res) => {
  const { token } = req.params;

  try {
    if (!token) {
      return res.status(400).json({ message: 'Token de redefinição de senha é obrigatório' });
    }

    const isValid = await authService.verifyResetToken(token);

    if (!isValid) {
      return res.status(400).json({ message: 'Token inválido ou expirado' });
    }

    res.status(200).json({ message: 'Token válido' });
  } catch (error) {
    logger.error('Erro ao verificar token de redefinição de senha', { service: 'authController', function: 'verifyResetToken', error: error.message });
    res.status(500).json({ message: 'Erro ao verificar token', error: error.message });
  }
};

/**
 * Marks a user's phone as verified after client-side Firebase Phone Auth
 * @async
 * @function verifyPhone
 * @param {Object} req - Express request object
 * @param {Object} req.user - Authenticated user (set by verifyToken middleware)
 * @param {Object} req.body - Request body
 * @param {boolean} req.body.phoneVerified - Must be true
 * @param {string} req.body.telefone - E.164 formatted phone number
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Updated user data
 * @description Updates phone_verified in Supabase and optionally links phone to Firebase Auth
 */
exports.verifyPhone = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Não autorizado' });
    }

    const { phoneVerified, telefone } = req.body;
    if (!phoneVerified || !telefone) {
      return res.status(400).json({
        success: false,
        message: 'phoneVerified e telefone são obrigatórios',
      });
    }

    // Validate E.164 format
    if (!/^\+\d{10,15}$/.test(telefone)) {
      return res.status(400).json({
        success: false,
        message: 'Telefone deve estar no formato E.164 (ex: +5511987654321)',
      });
    }

    // 1. Update Supabase user record
    const updatedUser = await User.update(userId, {
      telefone,
      phoneVerified: true,
      phoneVerifiedAt: new Date().toISOString(),
    });

    // 2. Link phone number in Firebase Auth (best-effort)
    try {
      const auth = getAuth();
      await auth.updateUser(userId, { phoneNumber: telefone });
      logger.info('verifyPhone: phone linked in Firebase Auth', {
        service: 'authController', userId,
      });
    } catch (firebaseErr) {
      // Non-critical: Firebase phone link may fail if already linked or provider issue
      logger.warn('verifyPhone: failed to link phone in Firebase Auth (non-critical)', {
        service: 'authController', userId, error: firebaseErr.message,
      });
    }

    // [GAME-COV-001] Gamificação: telefone verificado
    gamificationService.triggerEvent('phone_verified', userId).catch(() => {});

    logger.info('verifyPhone: phone verified successfully', {
      service: 'authController', userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Telefone verificado com sucesso',
      user: updatedUser,
    });
  } catch (error) {
    logger.error('verifyPhone: error', {
      service: 'authController',
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar telefone',
      error: error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT RECOVERY VIA PHONE — Endpoints públicos para usuários sem acesso ao email
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mascara um email para exibição pública.
 * "alice@gmail.com" -> "a***@gmail.com"
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `${local}***@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Limpa telefone para apenas dígitos.
 * @param {string} phone
 * @returns {string}
 */
function cleanPhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

/**
 * POST /api/auth/recovery/lookup-phone
 * Public endpoint — verifica se um telefone está registrado e verificado.
 * Retorna: { found: boolean, maskedEmail: "a***@gmail.com" }
 * NÃO retorna userId nem email completo por segurança.
 */
exports.lookupPhoneForRecovery = async (req, res) => {
  const { telefone } = req.body;

  if (!telefone) {
    return res.status(400).json({ success: false, message: 'Telefone é obrigatório.' });
  }

  try {
    const digits = cleanPhone(telefone);
    if (digits.length < 10) {
      return res.status(400).json({ success: false, message: 'Número de telefone inválido.' });
    }

    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
    }

    // Busca por telefone verificado — usa LIKE para match com/sem formatação
    const { data: users, error: dbError } = await supabase
      .from('users')
      .select('id, email')
      .like('telefone', `%${digits.slice(-10)}%`)
      .eq('phone_verified', true)
      .eq('is_active', true)
      .limit(1);

    if (dbError) {
      logger.error('lookupPhoneForRecovery: erro no Supabase', {
        service: 'authController', error: dbError.message,
      });
      return res.status(500).json({ success: false, message: 'Erro ao buscar conta.' });
    }

    if (!users || users.length === 0) {
      // Resposta genérica para não vazar informações
      return res.status(200).json({ success: true, found: false });
    }

    const user = users[0];
    return res.status(200).json({
      success: true,
      found: true,
      maskedEmail: maskEmail(user.email),
    });

  } catch (error) {
    logger.error('lookupPhoneForRecovery: erro inesperado', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /api/auth/recovery/verify-phone
 * Public endpoint — após verificação Firebase Phone Auth,
 * valida ownership do telefone e retorna um recovery ticket.
 * Body: { telefone, firebaseIdToken }
 */
exports.verifyPhoneForRecovery = async (req, res) => {
  const { telefone, firebaseIdToken } = req.body;

  if (!telefone || !firebaseIdToken) {
    return res.status(400).json({
      success: false,
      message: 'Telefone e token de verificação são obrigatórios.',
    });
  }

  try {
    const digits = cleanPhone(telefone);

    // 1. Verificar o Firebase ID token da sessão de phone auth
    const auth = getAuth();
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(firebaseIdToken);
    } catch (tokenErr) {
      logger.warn('verifyPhoneForRecovery: token Firebase inválido', {
        service: 'authController', error: tokenErr.message,
      });
      return res.status(401).json({
        success: false,
        message: 'Verificação de telefone inválida ou expirada.',
      });
    }

    // Verificar que o token realmente veio de phone auth
    const tokenPhone = cleanPhone(decodedToken.phone_number || '');
    if (!tokenPhone || !tokenPhone.endsWith(digits.slice(-10))) {
      return res.status(401).json({
        success: false,
        message: 'O telefone verificado não corresponde ao informado.',
      });
    }

    // 2. Buscar o usuário dono desse telefone verificado
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
    }

    const { data: users, error: dbError } = await supabase
      .from('users')
      .select('id, email, recovery_email, recovery_email_verified')
      .like('telefone', `%${digits.slice(-10)}%`)
      .eq('phone_verified', true)
      .eq('is_active', true)
      .limit(1);

    if (dbError || !users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conta não encontrada com este telefone verificado.',
      });
    }

    const user = users[0];

    // 3. Gerar recovery ticket de curta duração
    const { code, expiresIn } = await SecurityTicketService.generateTicket(
      user.id,
      'account_recovery',
      {
        ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        metadata: { telefone: digits, purpose: 'account_recovery' },
      }
    );

    logger.info('verifyPhoneForRecovery: ticket de recovery gerado', {
      service: 'authController', userId: user.id,
    });

    const hasRecoveryEmail = !!(user.recovery_email && user.recovery_email_verified);

    return res.status(200).json({
      success: true,
      recoveryTicket: code,
      expiresIn,
      options: ['change_email', 'reset_password'],
      hasRecoveryEmail,
      maskedEmail: maskEmail(user.email),
      maskedRecoveryEmail: hasRecoveryEmail ? maskEmail(user.recovery_email) : null,
    });

  } catch (error) {
    logger.error('verifyPhoneForRecovery: erro inesperado', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /api/auth/recovery/change-email
 * Protegido por recovery ticket — altera o email principal da conta.
 * Body: { recoveryTicket, newEmail, telefone }
 */
exports.recoveryChangeEmail = async (req, res) => {
  const { recoveryTicket, newEmail, telefone } = req.body;

  if (!recoveryTicket || !newEmail || !telefone) {
    return res.status(400).json({
      success: false,
      message: 'Recovery ticket, novo email e telefone são obrigatórios.',
    });
  }

  // Validação básica de email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail)) {
    return res.status(400).json({ success: false, message: 'Email inválido.' });
  }

  try {
    const digits = cleanPhone(telefone);

    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
    }

    // 1. Buscar o usuário pelo telefone verificado
    const { data: users, error: lookupErr } = await supabase
      .from('users')
      .select('id, email')
      .like('telefone', `%${digits.slice(-10)}%`)
      .eq('phone_verified', true)
      .eq('is_active', true)
      .limit(1);

    if (lookupErr || !users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'Conta não encontrada.' });
    }

    const user = users[0];

    // 2. Validar recovery ticket
    try {
      await SecurityTicketService.validateTicket(user.id, 'account_recovery', recoveryTicket);
    } catch (ticketErr) {
      return res.status(401).json({
        success: false,
        message: ticketErr.message || 'Ticket de recuperação inválido ou expirado.',
      });
    }

    // 3. Verificar se o novo email já está em uso
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id')
      .eq('email', newEmail.toLowerCase())
      .neq('id', user.id)
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Este email já está em uso por outra conta.',
      });
    }

    // 4. Atualizar email no Firebase Auth
    const auth = getAuth();
    try {
      await auth.updateUser(user.id, { email: newEmail.toLowerCase() });
    } catch (fbErr) {
      logger.error('recoveryChangeEmail: falha ao atualizar Firebase Auth', {
        service: 'authController', userId: user.id, error: fbErr.message,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro ao atualizar email. Tente novamente.',
      });
    }

    // 5. Atualizar email no Supabase
    const { error: updateErr } = await supabase
      .from('users')
      .update({ email: newEmail.toLowerCase(), updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (updateErr) {
      logger.error('recoveryChangeEmail: falha ao atualizar Supabase', {
        service: 'authController', userId: user.id, error: updateErr.message,
      });
      // Firebase já foi atualizado — logar mas não falhar
    }

    logger.info('recoveryChangeEmail: email alterado com sucesso', {
      service: 'authController', userId: user.id,
      oldEmail: maskEmail(user.email), newEmail: maskEmail(newEmail),
    });

    return res.status(200).json({
      success: true,
      message: 'Email alterado com sucesso. Faça login com o novo email.',
    });

  } catch (error) {
    logger.error('recoveryChangeEmail: erro inesperado', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /api/auth/recovery/send-reset
 * Protegido por recovery ticket — envia link de redefinição de senha.
 * Body: { recoveryTicket, telefone, useRecoveryEmail }
 */
exports.recoverySendReset = async (req, res) => {
  const { recoveryTicket, telefone, useRecoveryEmail } = req.body;

  if (!recoveryTicket || !telefone) {
    return res.status(400).json({
      success: false,
      message: 'Recovery ticket e telefone são obrigatórios.',
    });
  }

  try {
    const digits = cleanPhone(telefone);

    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
    }

    // 1. Buscar o usuário pelo telefone verificado
    const { data: users, error: lookupErr } = await supabase
      .from('users')
      .select('id, email, recovery_email, recovery_email_verified')
      .like('telefone', `%${digits.slice(-10)}%`)
      .eq('phone_verified', true)
      .eq('is_active', true)
      .limit(1);

    if (lookupErr || !users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'Conta não encontrada.' });
    }

    const user = users[0];

    // 2. Validar recovery ticket
    try {
      await SecurityTicketService.validateTicket(user.id, 'account_recovery', recoveryTicket);
    } catch (ticketErr) {
      return res.status(401).json({
        success: false,
        message: ticketErr.message || 'Ticket de recuperação inválido ou expirado.',
      });
    }

    // 3. Determinar email de destino
    let targetEmail;
    if (useRecoveryEmail && user.recovery_email && user.recovery_email_verified) {
      targetEmail = user.recovery_email;
    } else {
      targetEmail = user.email;
    }

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum email disponível para envio.',
      });
    }

    // 4. Gerar link de redefinição via Firebase Admin
    const auth = getAuth();
    let resetLink;
    try {
      resetLink = await auth.generatePasswordResetLink(targetEmail);
    } catch (fbErr) {
      logger.error('recoverySendReset: falha ao gerar link Firebase', {
        service: 'authController', userId: user.id, error: fbErr.message,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro ao gerar link de redefinição. Tente novamente.',
      });
    }

    // 5. Enviar por email via emailService
    try {
      await emailService.sendEmail({
        to: targetEmail,
        subject: 'Redefinição de senha - ElosCloud',
        templateType: 'password_reset',
        templateData: {
          userName: 'Usuário',
          resetLink,
          expiresIn: '1 hora',
        },
      });
    } catch (emailErr) {
      logger.warn('recoverySendReset: falha ao enviar email via emailService, link já gerado', {
        service: 'authController', userId: user.id, error: emailErr.message,
      });
      // O link já foi gerado — Firebase envia o seu próprio email de redefinição
    }

    logger.info('recoverySendReset: link de redefinição enviado', {
      service: 'authController', userId: user.id,
      sentTo: maskEmail(targetEmail),
    });

    return res.status(200).json({
      success: true,
      message: 'Link de redefinição enviado com sucesso.',
      sentTo: maskEmail(targetEmail),
    });

  } catch (error) {
    logger.error('recoverySendReset: erro inesperado', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Session Management — Active sessions list, revoke single, revoke all others
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lists all active (non-revoked, non-expired) sessions for the authenticated user
 * @async
 * @function getSessions
 */
exports.getSessions = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }

    const sessions = await sessionService.getUserSessions(userId);
    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    logger.error('getSessions: erro ao listar sessões', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao listar sessões.' });
  }
};

/**
 * Revokes a specific session by ID (soft-delete via revoked_at)
 * @async
 * @function revokeSession
 */
exports.revokeSession = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId é obrigatório.' });
    }

    const session = await sessionService.revokeSession(userId, sessionId);

    // Log the revocation for audit
    if (session?.refresh_token_hash) {
      logger.info('revokeSession: sessão revogada', {
        service: 'authController', userId, sessionId,
      });
    }

    return res.status(200).json({ success: true, message: 'Sessão encerrada.' });
  } catch (error) {
    logger.error('revokeSession: erro ao revogar sessão', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao encerrar sessão.' });
  }
};

/**
 * Revokes all sessions except the current one
 * @async
 * @function revokeAllSessions
 */
exports.revokeAllSessions = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }

    const currentSessionId = req.headers['x-session-id'] || null;
    await sessionService.revokeAllOtherSessions(userId, currentSessionId);

    logger.info('revokeAllSessions: todas as outras sessões revogadas', {
      service: 'authController', userId, keptSessionId: currentSessionId,
    });

    return res.status(200).json({ success: true, message: 'Todas as outras sessões foram encerradas.' });
  } catch (error) {
    logger.error('revokeAllSessions: erro ao revogar sessões', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao encerrar sessões.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MFA — Autenticacao em dois fatores (2FA)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/mfa/setup-totp
 * Gera segredo TOTP + QR code para configuracao do app autenticador.
 * Requer autenticacao (verifyToken).
 */
exports.setupTOTP = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Nao autorizado.' });
    }

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario nao encontrado.' });
    }

    const setup = await mfaService.generateTOTPSetup(userId, user.email);

    // Armazena segredo criptografado temporariamente (usuario ainda nao confirmou)
    await User.update(userId, { totp_secret: setup.secret });

    logger.info('setupTOTP: QR code gerado', { service: 'authController', userId });

    return res.json({
      success: true,
      qrCode: setup.qrCode,
      manualKey: setup.manualKey,
    });
  } catch (error) {
    logger.error('setupTOTP: erro', { service: 'authController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao configurar autenticador.' });
  }
};

/**
 * POST /api/auth/mfa/confirm-totp
 * Usuario digita codigo do app autenticador para confirmar setup.
 * Gera codigos de backup e ativa MFA.
 * Body: { code }
 */
exports.confirmTOTP = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Nao autorizado.' });
    }

    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Codigo e obrigatorio.' });
    }

    const user = await User.getById(userId);
    if (!user || !user.totpSecret) {
      return res.status(400).json({ success: false, message: 'TOTP nao configurado. Inicie o setup primeiro.' });
    }

    // Verificar codigo
    const valid = mfaService.verifyTOTPCode(user.totpSecret, code);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Codigo invalido. Tente novamente.' });
    }

    // Gerar codigos de backup
    const backupCodes = mfaService.generateBackupCodes();
    const encryptedCodes = mfaService.encryptBackupCodes(backupCodes);

    // Ativar MFA
    const currentMethod = user.mfaMethod;
    const method = currentMethod === 'sms' ? 'both' : 'totp';

    await User.update(userId, {
      mfa_enabled: true,
      mfa_method: method,
      backup_codes: encryptedCodes,
      backup_codes_count: 10,
      mfa_enabled_at: new Date().toISOString(),
    });

    logger.info('confirmTOTP: MFA TOTP ativado', { service: 'authController', userId, method });

    // Gamificacao: 2FA ativado
    gamificationService.triggerEvent('mfa_enabled', userId).catch(() => {});

    return res.json({
      success: true,
      backupCodes,
      method,
    });
  } catch (error) {
    logger.error('confirmTOTP: erro', { service: 'authController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao confirmar autenticador.' });
  }
};

/**
 * POST /api/auth/mfa/enable-sms
 * Ativa 2FA via SMS (requer telefone verificado).
 */
exports.enableSMS2FA = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Nao autorizado.' });
    }

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario nao encontrado.' });
    }

    if (!user.phoneVerified) {
      return res.status(400).json({ success: false, message: 'Telefone nao verificado. Verifique seu telefone primeiro.' });
    }

    let backupCodes = null;

    if (!user.mfaEnabled) {
      // Primeira vez ativando MFA — gerar codigos de backup
      const codes = mfaService.generateBackupCodes();
      backupCodes = codes;
      const encryptedCodes = mfaService.encryptBackupCodes(codes);

      await User.update(userId, {
        mfa_enabled: true,
        mfa_method: 'sms',
        backup_codes: encryptedCodes,
        backup_codes_count: 10,
        mfa_enabled_at: new Date().toISOString(),
      });

      logger.info('enableSMS2FA: MFA SMS ativado (primeiro metodo)', { service: 'authController', userId });
    } else {
      // Ja tem MFA — adicionar SMS como metodo
      const method = user.mfaMethod === 'totp' ? 'both' : 'sms';
      await User.update(userId, { mfa_method: method });
      logger.info('enableSMS2FA: SMS adicionado como metodo', { service: 'authController', userId, method });
    }

    // Gamificacao: 2FA ativado
    gamificationService.triggerEvent('mfa_enabled', userId).catch(() => {});

    return res.json({
      success: true,
      backupCodes,
      method: user.mfaEnabled ? (user.mfaMethod === 'totp' ? 'both' : 'sms') : 'sms',
    });
  } catch (error) {
    logger.error('enableSMS2FA: erro', { service: 'authController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao ativar 2FA por SMS.' });
  }
};

/**
 * POST /api/auth/mfa/disable
 * Desativa um metodo MFA ou todos.
 * Body: { method } — 'sms', 'totp', ou 'all'
 */
exports.disableMFA = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Nao autorizado.' });
    }

    const { method } = req.body;
    if (!method || !['sms', 'totp', 'all'].includes(method)) {
      return res.status(400).json({ success: false, message: 'Metodo invalido. Use: sms, totp ou all.' });
    }

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario nao encontrado.' });
    }

    if (method === 'all' || !user.mfaMethod || user.mfaMethod === method) {
      await User.update(userId, {
        mfa_enabled: false,
        mfa_method: null,
        totp_secret: null,
        backup_codes: null,
        backup_codes_count: 0,
        mfa_enabled_at: null,
      });
      logger.info('disableMFA: todos os metodos desativados', { service: 'authController', userId });
    } else if (method === 'sms' && user.mfaMethod === 'both') {
      await User.update(userId, { mfa_method: 'totp' });
      logger.info('disableMFA: SMS removido, TOTP mantido', { service: 'authController', userId });
    } else if (method === 'totp' && user.mfaMethod === 'both') {
      await User.update(userId, { mfa_method: 'sms', totp_secret: null });
      logger.info('disableMFA: TOTP removido, SMS mantido', { service: 'authController', userId });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('disableMFA: erro', { service: 'authController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao desativar 2FA.' });
  }
};

/**
 * GET /api/auth/mfa/status
 * Retorna status atual do MFA para o usuario autenticado.
 */
exports.getMFAStatus = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Nao autorizado.' });
    }

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario nao encontrado.' });
    }

    return res.json({
      success: true,
      mfaEnabled: user.mfaEnabled || false,
      mfaMethod: user.mfaMethod || null,
      backupCodesCount: user.backupCodesCount || 0,
      mfaEnabledAt: user.mfaEnabledAt || null,
      phoneVerified: user.phoneVerified || false,
    });
  } catch (error) {
    logger.error('getMFAStatus: erro', { service: 'authController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao obter status MFA.' });
  }
};

/**
 * POST /api/auth/mfa/verify
 * Verifica codigo MFA durante o login (endpoint publico com rate limit).
 * Body: { challengeToken, code, method } — method: 'totp', 'sms', ou 'backup'
 */
exports.verifyMFA = async (req, res) => {
  const { challengeToken, code, method } = req.body;

  if (!challengeToken || !code || !method) {
    return res.status(400).json({
      success: false,
      message: 'challengeToken, code e method sao obrigatorios.',
    });
  }

  if (!['totp', 'sms', 'backup'].includes(method)) {
    return res.status(400).json({
      success: false,
      message: 'Metodo invalido. Use: totp, sms ou backup.',
    });
  }

  try {
    // 1. Decodificar challengeToken
    let payload;
    try {
      payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Desafio expirado ou invalido. Faca login novamente.',
      });
    }

    if (payload.purpose !== 'mfa_challenge') {
      return res.status(401).json({ success: false, message: 'Token de desafio invalido.' });
    }

    const userId = payload.uid;

    // 2. Bloquear usuarios na blacklist
    if (isLocallyBlacklisted(userId)) {
      return res.status(401).json({ error: 'TOKEN_REVOKED' });
    }

    // 3. Buscar usuario
    const user = await User.getById(userId);
    if (!user || !user.mfaEnabled) {
      return res.status(400).json({ success: false, message: 'MFA nao esta ativo para este usuario.' });
    }

    // 4. Verificar codigo conforme metodo
    if (method === 'totp') {
      if (!user.totpSecret) {
        return res.status(400).json({ success: false, message: 'TOTP nao configurado.' });
      }
      const valid = mfaService.verifyTOTPCode(user.totpSecret, code);
      if (!valid) {
        return res.status(400).json({ success: false, message: 'Codigo invalido.' });
      }
    } else if (method === 'backup') {
      if (!user.backupCodes) {
        return res.status(400).json({ success: false, message: 'Codigos de backup nao configurados.' });
      }
      const result = mfaService.useBackupCode(user.backupCodes, code);
      if (!result.valid) {
        return res.status(400).json({ success: false, message: 'Codigo de backup invalido.' });
      }
      await User.update(userId, {
        backup_codes: result.remaining,
        backup_codes_count: result.count,
      });
    } else if (method === 'sms') {
      // SMS verification handled via SecurityTicketService (OTP)
      try {
        await SecurityTicketService.validateTicket(userId, 'mfa_sms', String(code).trim());
      } catch (ticketErr) {
        const isBruteForce = ticketErr.message?.includes('Muitas tentativas');
        return res.status(isBruteForce ? 429 : 400).json({
          success: false,
          message: ticketErr.message || 'Codigo SMS invalido ou expirado.',
        });
      }
    }

    // 5. Gerar JWT tokens (mesmo fluxo do login normal)
    const roles = await userRoleService.getUserRoles(userId);
    if (user) user.roles = roles;

    const tokens = authService.generateToken({
      uid: userId,
      email: user.email,
      roles,
      username: user?.username || null,
    });

    // Gamificacao: acesso diario
    gamificationService.triggerEvent('daily_access', userId).catch(() => {});

    // Create session record (fire-and-forget safe)
    let sessionId = null;
    try {
      const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
      sessionId = await sessionService.createSession(userId, tokens.refreshToken, deviceInfo);
      if (sessionId) await sessionService.markCurrentSession(userId, sessionId);
    } catch (sessErr) {
      logger.error('verifyMFA: falha ao criar sessão', { userId, error: sessErr.message });
    }

    // Configurar cookies
    res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    logger.info('verifyMFA: autenticacao MFA concluida', {
      service: 'authController', userId, method,
    });

    return res.status(200).json({
      success: true,
      isAuthenticated: true,
      user,
      tokens,
      sessionId,
    });
  } catch (error) {
    logger.error('verifyMFA: erro inesperado', {
      service: 'authController', error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao verificar MFA.' });
  }
};

/**
 * POST /api/auth/mfa/send-sms
 * Envia OTP por email para verificacao MFA durante login.
 * Body: { challengeToken }
 */
exports.sendMFASms = async (req, res) => {
  const { challengeToken } = req.body;

  if (!challengeToken) {
    return res.status(400).json({ success: false, message: 'challengeToken e obrigatorio.' });
  }

  try {
    let payload;
    try {
      payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Desafio expirado. Faca login novamente.' });
    }

    if (payload.purpose !== 'mfa_challenge') {
      return res.status(401).json({ success: false, message: 'Token invalido.' });
    }

    const userId = payload.uid;
    const user = await User.getById(userId);

    if (!user || !user.mfaEnabled) {
      return res.status(400).json({ success: false, message: 'MFA nao ativo.' });
    }

    if (!user.email) {
      return res.status(400).json({ success: false, message: 'Email nao encontrado.' });
    }

    // Gera OTP via SecurityTicketService e envia por email
    const { code, expiresIn } = await SecurityTicketService.generateTicket(userId, 'mfa_sms', {
      ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
      metadata: { purpose: 'mfa_sms_verification' },
    });

    const otpResult = await emailService.sendOTP({
      to: user.email,
      userName: user.nome || 'usuario',
      code,
      type: 'mfa_sms',
      expiresIn,
    });

    if (!otpResult.success) {
      logger.error('sendMFASms: falha ao enviar OTP', { userId, error: otpResult.error });

      if (otpResult.error === 'otp_rate_limit_exceeded') {
        return res.status(429).json({
          success: false,
          message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
          retryAfterSeconds: otpResult.retryAfterSeconds || 900,
        });
      }

      if (otpResult.error === 'recipient_suppressed') {
        return res.status(422).json({
          success: false,
          message: 'Não conseguimos enviar para este email. Entre em contato com o suporte.',
        });
      }

      return res.status(500).json({ success: false, message: 'Erro ao enviar codigo.' });
    }

    logger.info('sendMFASms: OTP enviado', { service: 'authController', userId });

    return res.json({ success: true, expiresIn });
  } catch (error) {
    logger.error('sendMFASms: erro', { service: 'authController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao enviar codigo.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Passwordless Auth — Access Code + Magic Link (AUTH-PL-002)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: completa login passwordless após verificação bem-sucedida.
 * Gera Firebase custom token, JWT, sessão e cookies.
 * Exportado para uso pelo webauthnController.
 */
async function _completePasswordlessLogin(userId, req, res) {
  // 1. Blacklist check
  if (isLocallyBlacklisted(userId)) {
    return res.status(401).json({ error: 'TOKEN_REVOKED' });
  }

  // 2. Buscar dados do usuário
  const user = await User.getById(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
  }

  // 3. Buscar roles
  const roles = await userRoleService.getUserRoles(userId);
  if (user) user.roles = roles;

  // 4. Gerar Firebase custom token (para frontend sincronizar Firebase Auth)
  let firebaseCustomToken = null;
  try {
    const auth = getAuth();
    firebaseCustomToken = await auth.createCustomToken(userId);
  } catch (fbErr) {
    logger.warn('Passwordless: falha ao gerar Firebase custom token (prosseguindo)', {
      userId, error: fbErr.message,
    });
  }

  // 5. Gerar JWT tokens
  const tokens = authService.generateToken({
    uid: userId,
    email: user?.email,
    roles,
    username: user?.username || null,
  });

  // 6. Sync Supabase (fire-and-forget)
  supabaseSyncService.syncUserToSupabase(user).catch(err =>
    logger.error('Erro na sincronização pós-login passwordless', { userId, error: err.message })
  );

  // 7. Gamificação: acesso diário
  gamificationService.triggerEvent('daily_access', userId).catch(() => {});

  // 8. Criar sessão
  let sessionId = null;
  try {
    const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
    sessionId = await sessionService.createSession(userId, tokens.refreshToken, deviceInfo);
    if (sessionId) {
      await sessionService.markCurrentSession(userId, sessionId);
    }
  } catch (sessErr) {
    logger.error('Passwordless: falha ao criar sessão', { userId, error: sessErr.message });
  }

  // 9. Cookies
  res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  return res.status(200).json({
    success: true,
    isAuthenticated: true,
    user,
    tokens,
    sessionId,
    firebaseCustomToken,
  });
}

/**
 * POST /auth/passwordless/send-code
 * Envia código de acesso temporário (8-char, 24h) por email.
 * Body: { email }
 */
exports.sendAccessCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email é obrigatório.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Email inválido.' });
    }

    const result = await accessCodeService.sendAccessCode(email);

    if (!result.success) {
      if (result.error === 'account_locked') {
        return res.status(429).json({
          success: false,
          message: 'Conta temporariamente bloqueada por tentativas excessivas.',
          locked_until: result.locked_until,
        });
      }
      return res.status(500).json({ success: false, message: 'Erro ao enviar código.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Se este email estiver cadastrado, um código de acesso será enviado.',
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    logger.error('sendAccessCode: erro', { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /auth/passwordless/verify-code
 * Verifica código de acesso e faz login.
 * Body: { email, code }
 */
exports.verifyAccessCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email e código são obrigatórios.' });
    }

    const result = await accessCodeService.verifyAccessCode(email, code);

    if (!result.success) {
      if (result.error === 'account_locked') {
        return res.status(429).json({
          success: false,
          message: 'Conta temporariamente bloqueada por tentativas excessivas.',
          locked_until: result.locked_until,
        });
      }
      return res.status(401).json({ success: false, message: 'Código inválido ou expirado.' });
    }

    // Login bem-sucedido → gerar tokens e sessão
    return _completePasswordlessLogin(result.userId, req, res);
  } catch (error) {
    logger.error('verifyAccessCode: erro', { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /auth/passwordless/send-link
 * Envia magic link de login por email.
 * Body: { email }
 */
exports.sendMagicLink = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email é obrigatório.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Email inválido.' });
    }

    const result = await magicLinkService.sendMagicLink(email, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (!result.success) {
      if (result.error === 'account_locked') {
        return res.status(429).json({
          success: false,
          message: 'Conta temporariamente bloqueada por tentativas excessivas.',
          locked_until: result.locked_until,
        });
      }
      return res.status(500).json({ success: false, message: 'Erro ao enviar link.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Se este email estiver cadastrado, um link de acesso será enviado.',
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    logger.error('sendMagicLink: erro', { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /auth/passwordless/verify-link
 * Verifica magic link token e faz login.
 * Body: { token }
 */
exports.verifyMagicLink = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token é obrigatório.' });
    }

    const result = await magicLinkService.verifyMagicLink(token);

    if (!result.success) {
      if (result.error === 'account_locked') {
        return res.status(429).json({
          success: false,
          message: 'Conta temporariamente bloqueada por tentativas excessivas.',
          locked_until: result.locked_until,
        });
      }
      return res.status(401).json({ success: false, message: 'Link inválido ou expirado.' });
    }

    // Login bem-sucedido → gerar tokens e sessão
    return _completePasswordlessLogin(result.userId, req, res);
  } catch (error) {
    logger.error('verifyMagicLink: erro', { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

/**
 * POST /auth/passwordless/register
 * Registro sem senha — cria Firebase user via Admin SDK (sem password),
 * persiste no DB, invalida convite, gera JWT + Firebase custom token.
 *
 * Body: { inviteId, username, nome, telefone, dataNascimento, fotoDoPerfil?, phoneVerified? }
 * Email vem do convite (fonte de verdade).
 */
exports.passwordlessRegister = async (req, res) => {
  const auth = getAuth();
  const ja3Hash = req.ja3Hash;
  const {
    inviteId, username, nome: rawNome, telefone,
    dataNascimento, fotoDoPerfil, phoneVerified,
  } = req.body;

  // Validação básica
  if (!inviteId) {
    return res.status(400).json({ success: false, message: 'Convite é obrigatório.' });
  }
  // [HANDLE-003] Regex com hifen — espelha handleService.HANDLE_REGEX
  if (!username || !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(username) || /--/.test(username)) {
    return res.status(400).json({ success: false, message: 'Username inválido.' });
  }

  const nome = typeof rawNome === 'string' ? rawNome.trim().substring(0, 120) : undefined;
  if (!nome || nome.length < 2 || !/^[\p{L}\s'.\-]+$/u.test(nome)) {
    return res.status(400).json({ success: false, message: 'Nome inválido. Use apenas letras, espaços e acentos.' });
  }

  // ja3Hash é opcional no registro passwordless — convite validado é a prova de identidade.
  // firstAccess middleware não roda aqui (não há Firebase token no body).
  if (!ja3Hash) {
    logger.info('Registro passwordless sem ja3Hash (esperado — convite é prova de identidade)', { ip: req.ip });
  }

  let userId = null;

  try {
    // 1. Validar convite e obter email
    const invite = await inviteService.getInviteById(inviteId);
    if (!invite || invite.status !== 'validated') {
      return res.status(400).json({ success: false, message: 'Convite inválido ou não validado.' });
    }
    const email = invite.recipientEmail || invite.email;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email do convite não encontrado.' });
    }

    // 2. Criar Firebase Auth user SEM senha (Admin SDK)
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({
        email,
        displayName: nome,
        emailVerified: true, // convite = email validado (D1)
      });
      userId = firebaseUser.uid;
    } catch (fbErr) {
      if (fbErr.code === 'auth/email-already-exists') {
        return res.status(409).json({ success: false, message: 'Email já cadastrado. Faça login.' });
      }
      throw fbErr;
    }

    // 3. Persistir usuário no DB
    const userData = {
      uid: userId,
      email,
      emailVerified: true,
      ja3Hash,
      nome,
      username,
      telefone: telefone || null,
      dataNascimento: dataNascimento || null,
      fotoDoPerfil: fotoDoPerfil || null,
      phoneVerified: phoneVerified || false,
      dataCriacao: Date.now(),
    };
    const user = await userService.addUser(userData);

    // 4. Sync Supabase (síncrono — user DEVE existir antes de getToken)
    try {
      await supabaseSyncService.syncUserToSupabase(user);
      logger.info('Passwordless register: Supabase sync OK', { userId });
    } catch (syncErr) {
      logger.error('Passwordless register: Supabase sync falhou (não-fatal)', {
        userId, error: syncErr.message,
      });
    }

    // 5. Gamificação: novo usuário
    gamificationService.triggerEvent('user_created', userId).catch(() => {});

    // 6. Invalidar convite
    if (inviteId) {
      const inviteResult = await inviteService.invalidateInvite(inviteId, userId);
      if (inviteResult.caxinhaInviteId && inviteResult.caixinhaId) {
        await caixinhaInviteService.linkToRegisteredUser(
          inviteResult.caxinhaInviteId,
          inviteResult.caixinhaId,
          userId
        );
      }
    }

    // 7. Business invites
    const businessInviteService = require('../services/businessInviteService');
    businessInviteService.processRegistrationInvites(email, userId)
      .catch(err => logger.error('processRegistrationInvites falhou', { error: err.message, userId }));

    // 8. Buscar roles
    const roles = await userRoleService.getUserRoles(userId);
    if (user) user.roles = roles;

    // 9. Firebase custom token (para frontend sincronizar Firebase Auth)
    let firebaseCustomToken = null;
    try {
      firebaseCustomToken = await auth.createCustomToken(userId);
    } catch (fbErr) {
      logger.warn('Passwordless register: falha ao gerar custom token', { userId, error: fbErr.message });
    }

    // 10. Gerar JWT
    const tokens = authService.generateToken({ uid: userId, email, roles, username });

    // 11. Criar sessão
    let sessionId = null;
    try {
      const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
      sessionId = await sessionService.createSession(userId, tokens.refreshToken, deviceInfo);
      if (sessionId) await sessionService.markCurrentSession(userId, sessionId);
    } catch (sessErr) {
      logger.error('Passwordless register: falha ao criar sessão', { userId, error: sessErr.message });
    }

    // 12. Cookies
    res.cookie('authorization', `Bearer ${tokens.accessToken}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return res.status(201).json({
      success: true,
      message: 'Registro concluído com sucesso',
      isAuthenticated: true,
      isFirstAccess: true,
      user,
      tokens,
      sessionId,
      firebaseCustomToken,
    });
  } catch (error) {
    logger.error('Erro no registro passwordless', { error: error.message, inviteId });

    // Cleanup: deletar Firebase Auth user órfão
    if (userId) {
      try {
        await auth.deleteUser(userId);
        logger.info('Firebase Auth user órfão deletado após falha no registro passwordless', { userId });
      } catch (cleanupErr) {
        logger.error('Falha ao limpar Firebase Auth user órfão', { userId, error: cleanupErr.message });
      }
    }

    return res.status(500).json({ success: false, message: 'Erro ao processar registro.' });
  }
};

// Exportar helper para uso pelo webauthnController
exports._completePasswordlessLogin = _completePasswordlessLogin;

// ═══════════════════════════════════════════════════════════════
// AUTH-PL-006: Admin — Transição passwordless
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/admin/auth/password-transition/start
 * Dispara batch de emails de transição para users não notificados.
 */
exports.startPasswordTransition = async (req, res) => {
  const fn = 'authController.startPasswordTransition';
  try {
    const Joi = require('joi');
    const schema = Joi.object({
      batchSize: Joi.number().integer().min(1).max(500).optional(),
      dryRun: Joi.boolean().optional(),
    });
    const { error: valErr, value } = schema.validate(req.body || {});
    if (valErr) {
      return res.status(400).json({ success: false, message: valErr.message });
    }

    const passwordTransitionService = require('../services/passwordTransitionService');
    const result = await passwordTransitionService.sendTransitionBatch(value);

    logger.info(`[${fn}] Batch executado`, { ...result, admin: req.user?.uid });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error(`[${fn}] Erro`, { error: err.message });
    return res.status(500).json({ success: false, message: 'Erro ao executar batch de transição.' });
  }
};

/**
 * GET /api/admin/auth/password-transition/stats
 * Retorna estatísticas da transição passwordless.
 */
exports.getPasswordTransitionStats = async (req, res) => {
  const fn = 'authController.getPasswordTransitionStats';
  try {
    const passwordTransitionService = require('../services/passwordTransitionService');
    const stats = await passwordTransitionService.getTransitionStats();

    return res.status(200).json({ success: true, ...stats });
  } catch (err) {
    logger.error(`[${fn}] Erro`, { error: err.message });
    return res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas.' });
  }
};