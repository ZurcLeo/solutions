/**
 * @fileoverview Serviço de autenticação - gerencia tokens JWT e validações
 * @module services/authService
 * @requires firebaseAdmin
 * @requires jsonwebtoken
 * @requires ../models/User
 * @requires ../logger
 * @requires ./blacklistService
 * @requires ./inviteService
 * @requires uuid
 * @requires dotenv
 */

//eloscloudapp/services/authService.js
const { getAuth } = require('../firebaseAdmin');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { logger } = require('../logger')
const { addToBlacklist, isTokenBlacklisted } = require('./blacklistService');
const { invalidateInvite } = require('./inviteService');
const userRoleService = require('./userRoleService');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();


/**
 * Gera tokens JWT de acesso e refresh
 * @function generateToken
 * @param {Object} payload - Dados do usuário para incluir no token
 * @param {string} payload.uid - ID do usuário
 * @param {string} payload.email - Email do usuário
 * @param {Array} [payload.roles] - Roles do usuário
 * @returns {Object} Objeto contendo accessToken e refreshToken
 * @description Cria tokens JWT com tempos de expiração diferentes (15min access, 7d refresh)
 */
const generateToken = (payload) => {
  try {
    logger.info('Gerando tokens', { uid: payload.uid });
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
  } catch (error) {
    logger.error('Erro ao gerar token:', { uid: payload?.uid, error: error.message });
    return {}; // ou lançar o erro
  }
};

/**
 * Gera token de refresh para o usuário
 * @function generateRefreshToken
 * @param {Object} user - Objeto do usuário
 * @returns {string} Token de refresh JWT
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    { 
      uid: user.uid,
      email: user.email,
      roles: user.roles || []
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

const verifyAndGenerateNewToken = async (refreshToken) => {
  try {
    // Decodificar e verificar o refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Verificar se o refresh token foi revogado (blacklist)
    const isBlacklisted = await isTokenBlacklisted(refreshToken);
    if (isBlacklisted) {
      throw new Error('Refresh token revogado.');
    }

    // Buscar roles atualizadas antes de gerar novos tokens
    const roles = await userRoleService.getUserRoles(decoded.uid);

    const userData = {
      uid: decoded.uid,
      email: decoded.email,
      roles: roles || [],
      username: decoded.username || null
    };

    // Gerar novos tokens de acesso e refresh
    const { accessToken, refreshToken: newRefreshToken } = generateToken(userData);

    return { 
      accessToken, 
      refreshToken: newRefreshToken,
      userData
    };
  } catch (error) {
    console.error('Erro ao verificar e renovar token:', error.message);
    throw new Error('Erro ao verificar e renovar token: ' + error.message);
  }
};

const registerWithEmail = async (userData, email, password, inviteId) => {
  // const auth = getAuth();
  // const inviteRef = await validateInvite(inviteId);
  // const userRecord = await auth.createUser({ email, password });
  // await sendEmailVerification(userRecord.uid);
  const user = await User.create(userData);
  await invalidateInvite(inviteId, email);

  // const accessToken = generateToken({ uid: userData.uid });
  // const refreshToken = generateRefreshToken({ uid: userData.uid });
  return { message: 'Conta criada com sucesso', user };
};

const signInWithEmail = async (email, password) => {
  const auth = getAuth();
  const userRecord = await auth.getUserByEmail(email);
  const accessToken = await auth.createCustomToken(userRecord.uid);

  if (!userRecord.emailVerified) {
    throw new Error('Por favor, verifique seu e-mail.');
  }

  await User.create(userRecord);

  const refreshToken = generateRefreshToken({ uid: userRecord.uid });
  return { message: 'Login bem-sucedido', accessToken, refreshToken };
};

const logout = async (idToken) => {
  await addToBlacklist(idToken);
  return { message: 'Logout successful and token blacklisted' };
};

const signInWithProvider = async (firebaseToken) => {
  const auth = getAuth();
  const decodedToken = await auth.verifyIdToken(firebaseToken);
  const userRecord = await auth.getUser(decodedToken.uid);

  // if (!userRecord.emailVerified) {
  //   throw new Error('Please verify your email first');
  // }

  // await createUserProfile(userRecord);
  
  // const accessToken = generateToken({ uid: userRecord.uid });
  // const refreshToken = generateRefreshToken({ uid: userRecord.uid });

  return {
    // accessToken,
    // refreshToken,
    success: true,
    user: userRecord
  };
};

// resendVerificationEmail removido — verificação de email agora usa OTP
// via SecurityTicketService + emailService (ver authController.sendEmailVerificationOtp)

const getCurrentUser = async (userId) => {
  const userProfile = await User.getById(userId);

  const userData = {
    ...userProfile
  };
  return userData;
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyAndGenerateNewToken,
  registerWithEmail,
  signInWithEmail,
  logout,
  signInWithProvider,
  getCurrentUser
};