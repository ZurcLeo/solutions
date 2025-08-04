/**
 * @fileoverview Serviço de autenticação - gerencia tokens JWT e validações
 * @module services/authService
 * @requires firebaseAdmin
 * @requires jsonwebtoken
 * @requires ../models/User
 * @requires ../models/Invite
 * @requires ../logger
 * @requires ./blacklistService
 * @requires ./inviteService
 * @requires uuid
 * @requires dotenv
 */

//eloscloudapp/services/authService.js
const { getAuth, getFirestore } = require('../firebaseAdmin');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Invite = require('../models/Invite');
const { logger } = require('../logger')
const { addToBlacklist, isTokenBlacklisted } = require('./blacklistService');
const { validateInvite, invalidateInvite } = require('./inviteService');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const db = getFirestore();

/**
 * Gera tokens JWT de acesso e refresh
 * @function generateToken
 * @param {Object} payload - Dados do usuário para incluir no token
 * @param {string} payload.uid - ID do usuário
 * @param {string} payload.email - Email do usuário
 * @returns {Object} Objeto contendo accessToken e refreshToken
 * @description Cria tokens JWT com tempos de expiração diferentes (15min access, 7d refresh)
 */
const generateToken = (payload) => {
  try {
    logger.info('Payload para gerar token:', payload);
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    logger.info('Tokens gerados:', { accessToken, refreshToken });
    return { accessToken, refreshToken };
  } catch (error) {
    logger.error('Erro ao gerar token:', error);
    return {}; // ou lançar o erro
  }
};

/**
 * Gera token de refresh para o usuário
 * @function generateRefreshToken
 * @param {Object} user - Objeto do usuário
 * @param {string} user.uid - ID do usuário
 * @param {string} user.email - Email do usuário
 * @returns {string} Token de refresh JWT
 * @description Cria token de refresh com validade de 7 dias
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    { 
      uid: user.uid,
      email: user.email 
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

    // Em vez de buscar o usuário completo, usar os dados do token
    // para gerar novos tokens. Isso reduz uma consulta ao banco de dados.
    const userData = {
      uid: decoded.uid,
      // Outros dados necessários presentes no token
    };

    // Gerar novos tokens de acesso e refresh
    const accessToken = generateToken(userData);
    const newRefreshToken = generateRefreshToken(userData);

    return { 
      accessToken, 
      refreshToken: newRefreshToken,
      userData // Incluir dados básicos do usuário para reduzir consultas
    };
  } catch (error) {
    console.error('Erro ao verificar e renovar token:', error.message);
    throw new Error('Erro ao verificar e renovar token: ' + error.message);
  }
};

/**
 * Cria o perfil de um novo usuário e, se disponível, estabelece uma conexão com quem o convidou
 * @param {Object} userRecord - Dados do usuário do Firebase
 * @param {string} inviteId - ID do convite (opcional)
 */
const createUserProfile = async (userRecord, inviteId = null) => {
  const auth = getAuth();
  const userDocRef = db.doc(`usuario/${userRecord.uid}`);
  const docSnap = await userDocRef.get();

  if (docSnap.exists) {
    return; // Usuário já existe, não fazer nada
  }

  const batch = db.batch();
  const email = userRecord.email;
  const defaultName = email.substring(0, email.indexOf('@'));
  
  // Preparar dados básicos do usuário
  const userData = {
    email: userRecord.email,
    nome: userRecord.displayName || defaultName || 'ElosCloud.Cliente',
    perfilPublico: false,
    dataCriacao: auth.firestore.FieldValue.serverTimestamp(),
    uid: userRecord.uid,
    tipoDeConta: 'Cliente',
    interesses: {},
    ja3hash: userRecord.ja3hash,
    reacoes: [],
    isOwnerOrAdmin: false,
    descricao: '',
    saldoElosCoins: 0,
    fotoDoPerfil: process.env.DEFAULT_PROFILE_IMG,
    amigos: [],
    amigosAutorizados: [],
    conversas: {},
  };
  
  batch.set(userDocRef, userData);
  
  // Verificar se existe um convite e processar a conexão com o remetente
  if (inviteId) {
    try {
      // Buscar dados do convite
      const { invite } = await Invite.getById(inviteId);
      
      if (invite && invite.status === 'used' && invite.senderId) {
        // Criar referência de solicitação mútua entre o novo usuário e quem o convidou
        
        // 1. Solicitação ao novo usuário
        batch.set(db.doc(`conexoes/${userRecord.uid}/recebidas/${invite.senderId}`), {
          dataSolicitacao: auth.firestore.FieldValue.serverTimestamp(),
          nome: invite.senderName || 'Usuário que convidou',
          uid: invite.senderId,
          status: 'pendente',
          fotoDoPerfil: invite.senderPhotoURL || process.env.DEFAULT_PROFILE_IMG,
          descricao: 'Conecte-se com quem te convidou para a plataforma.',
          amigos: [],
          inviteId: inviteId  // Referência ao convite original
        });
        
        // 2. Solicitação ao remetente do convite
        batch.set(db.doc(`conexoes/${invite.senderId}/enviadas/${userRecord.uid}`), {
          dataSolicitacao: auth.firestore.FieldValue.serverTimestamp(),
          nome: userRecord.displayName || defaultName,
          uid: userRecord.uid,
          status: 'pendente',
          fotoDoPerfil: process.env.DEFAULT_PROFILE_IMG,
          descricao: 'Usuário que você convidou criou uma conta.',
          amigos: [],
          inviteId: inviteId  // Referência ao convite original
        });
        
        console.log(`Criadas solicitações de conexão entre ${userRecord.uid} e ${invite.senderId}`);
      }
    } catch (error) {
      console.error(`Erro ao processar conexão do convite ${inviteId}:`, error);
      // Continuar mesmo com erro na conexão
    }
  }
  
  // Sempre adicionar o suporte como contato
  batch.set(db.doc(`conexoes/${userRecord.uid}/recebidas/${process.env.SUPPORT_PROFILE_ID}`), {
    dataSolicitacao: auth.firestore.FieldValue.serverTimestamp(),
    nome: 'Suporte ElosCloud',
    uid: process.env.SUPPORT_PROFILE_ID,
    status: 'pendente',
    fotoDoPerfil: process.env.SUPPORT_PROFILE_IMG,
    descricao: 'Estamos aqui para ajudar. Conecte-se para receber suporte.',
    amigos: [],
  });
  
  try {
    await batch.commit();
    console.log(`Perfil criado com sucesso para o usuário: ${userRecord.email}`);
  } catch (error) {
    console.error(`Erro ao criar perfil para o usuário: ${userRecord.email}`, error);
    throw new Error(`Erro ao criar perfil para o usuário: ${error.message}`);
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

const resendVerificationEmail = async () => {
  const auth = getAuth();
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser);
    return { message: 'E-mail de verificação reenviado.' };
  }
  throw new Error('Erro ao reenviar e-mail de verificação');
};

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
  createUserProfile,
  registerWithEmail,
  signInWithEmail,
  logout,
  signInWithProvider,
  resendVerificationEmail,
  getCurrentUser
};