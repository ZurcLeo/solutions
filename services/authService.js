const { getAuth, getFirestore, auth } = require('../firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getFacebookUserData } = require('./facebookService');
const { addToBlacklist, isTokenBlacklisted } = require('./blacklistService');
const { validateInvite, invalidateInvite } = require('./inviteService');
require('dotenv').config();

/**
 * Verifica e decodifica um token usando o Firebase Admin.
 * @param {string} idToken - O token de ID a ser verificado.
 * @returns {Promise<Object>} - Os dados decodificados do token.
 */
const verifyIdToken = async (idToken) => {
  try {
    const auth = getAuth(); // Obtenha a instância de Auth
    const decodedToken = await auth.verifyIdToken(idToken); // Verifica e decodifica o token
    logger.info('Token verificado com sucesso no authService', {
      service: 'authService',
      function: 'verifyIdToken',
      userId: decodedToken.uid,
    });
    return decodedToken;
  } catch (error) {
    logger.error('Erro ao verificar o token no authService', {
      service: 'authService',
      function: 'verifyIdToken',
      error: error.message,
    });
    throw error;
  }
};

const generateToken = (user) => {
  // Gerar access token com tempo de expiração curto
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

const generateRefreshToken = (user) => {
  // Gerar refresh token com um tempo de expiração maior
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

const verifyAndGenerateNewToken = async (refreshToken) => {
  try {
    // Decodificar e verificar o refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Verifique se o refresh token foi revogado (blacklist)
    const isBlacklisted = await isTokenBlacklisted(refreshToken);
    if (isBlacklisted) {
      throw new Error('Refresh token revogado.');
    }

    // Buscar o usuário associado ao refresh token
    const user = await User.findById(decoded.id);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    // Gerar novos tokens de acesso e refresh token
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  } catch (error) {
    console.error('Erro ao verificar e renovar token:', error.message);
    throw new Error('Erro ao verificar e renovar token: ' + error.message);
  }
};

const ensureUserProfileExists = async (userRecord, inviteId, transaction) => {
  const db = getFirestore();
  const userDocRef = db.collection('usuario').doc(userRecord.uid);
  
  const docSnap = await transaction.get(userDocRef);

  if (!docSnap.exists) {
    const email = userRecord.email;
    const defaultName = email.substring(0, email.indexOf('@'));

    // Define os dados do usuário
    const userData = {
      email: userRecord.email,
      nome: userRecord.displayName || defaultName || 'ElosCloud.Cliente',
      perfilPublico: false,
      dataCriacao: FieldValue.serverTimestamp(),
      uid: userRecord.uid,
      tipoDeConta: 'Cliente',
      isOwnerOrAdmin: false,
      inviteId,
      fotoDoPerfil: process.env.CLAUD_PROFILE_IMG,
      amigos: [process.env.CLAUD_PROFILE],
      amigosAutorizados: [],
      conversasComMensagensNaoLidas: [],
    };

    // Set do perfil do usuário
    transaction.set(userDocRef, userData);

    // Set da solicitação do Claud
    transaction.set(
      db.collection('conexoes')
        .doc(userRecord.uid)
        .collection('solicitadas')
        .doc(process.env.CLAUD_PROFILE),
      {
        dataSolicitacao: FieldValue.serverTimestamp(),
        nome: 'Claud Suporte',
        uid: process.env.CLAUD_PROFILE,
        status: 'pendente',
        fotoDoPerfil: process.env.CLAUD_PROFILE_IMG,
        descricao: 'Gostaria de conectar com você.',
        amigos: [],
      }
    );
  }
};

const facebookLogin = async (accessToken) => {
  const userData = await getFacebookUserData(accessToken);
  await ensureUserProfileExists(userData);
  return userData;
};

const registerWithEmail = async (email, password, validationId) => {
  const db = getFirestore();

  try {
    // Recuperar o documento de validação
    const validationRef = db.collection('tempValidations').doc(validationId);
    const validationDoc = await validationRef.get();

    if (!validationDoc.exists) throw new Error('Validação não encontrada ou expirada');

    const validationData = validationDoc.data();

    if (new Date(validationData.expiresAt.toDate()) < new Date()) {
      throw new Error('Validação expirada');
    }

    // Criar usuário no Firebase Auth
    const userRecord = await auth.createUser({ email, password });

    // Criar perfil do usuário no Firestore
    const userRef = db.collection('usuario').doc(userRecord.uid);
    await userRef.set({
      email: userRecord.email,
      nome: validationData.nome,
      inviteId: validationData.inviteId,
      dataCriacao: FieldValue.serverTimestamp(),
    });

    // Atualizar o status da validação
    await validationRef.update({ status: 'used' });

    return { success: true };
  } catch (error) {
    console.error('Erro ao registrar com email:', error);
    throw new Error('Falha ao registrar usuário');
  }
};


const signInWithEmail = async (email, password) => {
  const userRecord = await auth.getUserByEmail(email);
  const accessToken = await auth.createCustomToken(userRecord.uid);

  if (!userRecord.emailVerified) {
    throw new Error('Por favor, verifique seu e-mail.');
  }

  await ensureUserProfileExists(userRecord);

  const refreshToken = generateRefreshToken({ uid: userRecord.uid });
  return { message: 'Login bem-sucedido', accessToken, refreshToken };
};

const logout = async (idToken) => {
  await addToBlacklist(idToken);
  return { message: 'Logout successful and token blacklisted' };
};

const signInWithProvider = async (idToken, provider) => {
  const decodedToken = await auth.verifyIdToken(idToken);
  const uid = decodedToken.uid;
  const userRecord = await auth.getUser(uid);

  if (!userRecord.emailVerified) {
    throw new Error('Por favor, verifique seu e-mail.');
  }

  await ensureUserProfileExists(userRecord);
  const accessToken = generateToken({ uid: userRecord.uid });
  const refreshToken = generateRefreshToken({ uid: userRecord.uid });
  return { message: 'Login com provedor bem-sucedido', accessToken, refreshToken, user: userRecord };
};

const registerWithProvider = async (provider, validationId) => {
  const db = getFirestore();
  
  try {
    const { GoogleAuthProvider, OAuthProvider, signInWithPopup } = require('firebase/auth');

    // Recupera a validação temporária
    const validationRef = db.collection('tempValidations').doc(validationId);
    const validationDoc = await validationRef.get();

    if (!validationDoc.exists) {
      throw new Error('Validação não encontrada ou expirada');
    }

    const validationData = validationDoc.data();

    // Verifica a expiração da validação
    if (new Date(validationData.expiresAt.toDate()) < new Date()) {
      throw new Error('Validação expirada');
    }

    // Configura o provedor de autenticação
    let providerToUse;
    if (provider === 'google') {
      providerToUse = new GoogleAuthProvider();
      providerToUse.setCustomParameters({ prompt: 'select_account' });
    } else if (provider === 'microsoft') {
      providerToUse = new OAuthProvider('microsoft.com');
      providerToUse.setCustomParameters({ prompt: 'select_account' });
    } else {
      throw new Error('Provedor inválido');
    }

    // Realiza a autenticação com o provedor
    const userCredential = await signInWithPopup(auth, providerToUse);
    const user = userCredential.user;

    // Transação para persistir dados e garantir consistência
    await db.runTransaction(async (transaction) => {
      const userProfileRef = db.collection('usuario').doc(user.uid);
      const userProfileDoc = await transaction.get(userProfileRef);

      if (!userProfileDoc.exists) {
        await ensureUserProfileExists(user, validationData.inviteId, transaction);
      }

      // Atualiza o status do convite original
      const inviteRef = db.collection('convites').doc(validationData.inviteId);
      const inviteDoc = await transaction.get(inviteRef);

      if (!inviteDoc.exists) {
        throw new Error('Convite associado não encontrado');
      }

      transaction.update(inviteRef, {
        status: 'used',
        validatedBy: user.email,
        validatedAt: FieldValue.serverTimestamp(),
      });

      // Remove a validação temporária
      transaction.delete(validationRef);
    });

    // Gera tokens de autenticação
    const accessToken = generateToken({ uid: user.uid });
    const refreshToken = generateRefreshToken({ uid: user.uid });

    return {
      success: true,
      message: 'Registro com provedor bem-sucedido',
      accessToken,
      refreshToken,
    };
  } catch (error) {
    logger.error('Erro no registro com provedor:', { error: error.message });
    throw new Error('Falha ao completar o registro com provedor');
  }
};

const resendVerificationEmail = async () => {
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser);
    return { message: 'E-mail de verificação reenviado.' };
  }
  throw new Error('Erro ao reenviar e-mail de verificação');
};

const getCurrentUser = async (userId) => {
  try {
    // Utilize o método estático `getById` do modelo `User` para buscar os dados
    const userProfile = await User.getById(userId);

    // Crie o objeto com os dados que serão retornados
    const userData = userProfile.toPlainObject();

    logger.info('Dados do usuário recuperados com sucesso no getCurrentUser', {
      service: 'authService',
      function: 'getCurrentUser',
      userId,
    });

    return userData;
  } catch (error) {
    logger.error(`Erro ao buscar dados do usuário no getCurrentUser: ${error.message}`, {
      service: 'authService',
      function: 'getCurrentUser',
      userId,
    });
    throw new Error(`Erro ao buscar dados do usuário: ${error.message}`);
  }
};


module.exports = {
  verifyIdToken,
  generateToken,
  generateRefreshToken,
  verifyAndGenerateNewToken,
  ensureUserProfileExists,
  facebookLogin,
  registerWithEmail,
  signInWithEmail,
  logout,
  signInWithProvider,
  registerWithProvider,
  resendVerificationEmail,
  getCurrentUser,
};