/**
 * @fileoverview WebAuthn Controller — Passkeys FIDO2
 * Ticket: AUTH-PL-003
 *
 * Endpoints para registro e autenticação via passkeys.
 * Registro: requer autenticação (usuário já logado adiciona passkey).
 * Autenticação: público (usuário faz login com passkey).
 */

'use strict';

const webauthnService = require('../services/webauthnService');
const { logger } = require('../logger');

const CTRL = 'webauthnController';

// ═══════════════════════════════════════════════════════════════════════════════
// Registration (requires auth — user adds passkey to their account)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth/webauthn/register-options
 * Gera opções de registro de passkey.
 * Requer autenticação (verifyToken).
 */
exports.getRegistrationOptions = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
    }

    const userName = req.user?.email || req.user?.username || userId;

    const { options, challengeToken } = await webauthnService.getRegistrationOptions(userId, userName);

    return res.status(200).json({
      success: true,
      options,
      challengeToken,
    });
  } catch (error) {
    logger.error(`[${CTRL}] getRegistrationOptions error`, { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao gerar opções de registro.' });
  }
};

/**
 * POST /auth/webauthn/register-verify
 * Verifica resposta de registro e armazena credencial.
 * Body: { challengeToken, registrationResponse, deviceName? }
 * Requer autenticação (verifyToken).
 */
exports.verifyRegistration = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
    }

    const { challengeToken, registrationResponse, deviceName } = req.body;

    if (!challengeToken || !registrationResponse) {
      return res.status(400).json({ success: false, message: 'challengeToken e registrationResponse são obrigatórios.' });
    }

    const result = await webauthnService.verifyRegistration(
      userId,
      challengeToken,
      registrationResponse,
      deviceName || null
    );

    if (!result.success) {
      const statusCode = result.error === 'challenge_expired' ? 401 : 400;
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    return res.status(201).json({
      success: true,
      credentialId: result.credentialId,
      message: 'Passkey registrada com sucesso.',
    });
  } catch (error) {
    logger.error(`[${CTRL}] verifyRegistration error`, { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao registrar passkey.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication (public — user logs in with passkey)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth/webauthn/auth-options
 * Gera opções de autenticação por passkey.
 * Body: { email }
 * Público (sem verifyToken).
 */
exports.getAuthenticationOptions = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email é obrigatório.' });
    }

    const result = await webauthnService.getAuthenticationOptions(email);

    if (result.noPasskeys) {
      return res.status(200).json({
        success: true,
        hasPasskeys: false,
        message: 'Nenhuma passkey registrada para esta conta.',
      });
    }

    return res.status(200).json({
      success: true,
      hasPasskeys: true,
      options: result.options,
      challengeToken: result.challengeToken,
    });
  } catch (error) {
    logger.error(`[${CTRL}] getAuthenticationOptions error`, { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao gerar opções de autenticação.' });
  }
};

/**
 * POST /auth/webauthn/auth-verify
 * Verifica resposta de autenticação e faz login.
 * Body: { challengeToken, authenticationResponse }
 * Público (sem verifyToken) — delega login a _completePasswordlessLogin.
 */
exports.verifyAuthentication = async (req, res) => {
  try {
    const { challengeToken, authenticationResponse } = req.body;

    if (!challengeToken || !authenticationResponse) {
      return res.status(400).json({ success: false, message: 'challengeToken e authenticationResponse são obrigatórios.' });
    }

    const result = await webauthnService.verifyAuthentication(challengeToken, authenticationResponse);

    if (!result.success) {
      const statusCode = result.error === 'challenge_expired' ? 401 : 400;
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    // Delega login completo ao authController helper
    const authController = require('./authController');
    if (typeof authController._completePasswordlessLogin === 'function') {
      return authController._completePasswordlessLogin(result.userId, req, res);
    }

    // Fallback: importar diretamente os serviços necessários
    const { isLocallyBlacklisted } = require('../utils/securityUtils');
    const User = require('../models/User');
    const userRoleService = require('../services/userRoleService');
    const authService = require('../services/authService');
    const sessionService = require('../services/sessionService');
    const supabaseSyncService = require('../services/supabaseSyncService');
    const gamificationService = require('../services/gamificationService');
    const { getAuth } = require('../firebaseAdmin');

    if (isLocallyBlacklisted(result.userId)) {
      return res.status(401).json({ error: 'TOKEN_REVOKED' });
    }

    const user = await User.getById(result.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    const roles = await userRoleService.getUserRoles(result.userId);
    if (user) user.roles = roles;

    let firebaseCustomToken = null;
    try {
      firebaseCustomToken = await getAuth().createCustomToken(result.userId);
    } catch {
      // non-critical
    }

    const tokens = authService.generateToken({
      uid: result.userId,
      email: user?.email,
      roles,
      username: user?.username || null,
    });

    supabaseSyncService.syncUserToSupabase(user).catch(() => {});
    gamificationService.triggerEvent('daily_access', result.userId).catch(() => {});

    let sessionId = null;
    try {
      const deviceInfo = sessionService.parseUserAgent(req.headers['user-agent'], req.ip);
      sessionId = await sessionService.createSession(result.userId, tokens.refreshToken, deviceInfo);
      if (sessionId) await sessionService.markCurrentSession(result.userId, sessionId);
    } catch {
      // non-critical
    }

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
  } catch (error) {
    logger.error(`[${CTRL}] verifyAuthentication error`, { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao autenticar com passkey.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Credential management (requires auth)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /auth/webauthn/credentials
 * Lista passkeys do usuário autenticado.
 */
exports.listCredentials = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
    }

    const credentials = await webauthnService.listCredentials(userId);

    return res.status(200).json({
      success: true,
      credentials,
    });
  } catch (error) {
    logger.error(`[${CTRL}] listCredentials error`, { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao listar passkeys.' });
  }
};

/**
 * DELETE /auth/webauthn/credentials/:credentialId
 * Remove uma passkey do usuário autenticado.
 */
exports.deleteCredential = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
    }

    const { credentialId } = req.params;
    if (!credentialId) {
      return res.status(400).json({ success: false, message: 'credentialId é obrigatório.' });
    }

    const result = await webauthnService.deleteCredential(userId, credentialId);

    if (!result.success) {
      const statusCode = result.error === 'not_found' ? 404 : 500;
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Passkey removida com sucesso.',
    });
  } catch (error) {
    logger.error(`[${CTRL}] deleteCredential error`, { error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao remover passkey.' });
  }
};
