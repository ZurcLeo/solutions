const { getAuth, auth } = require('../firebaseAdmin');
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

const ensureUserProfileExists = async (userRecord) => {
  const userDocRef = auth.firestore().doc(`usuario/${userRecord.uid}`);
  const docSnap = await userDocRef.get();

  if (!docSnap.exists) {
    const batch = auth.firestore().batch();
    const email = userRecord.email;
    const defaultName = email.substring(0, email.indexOf('@'));

    batch.set(userDocRef, {
      email: userRecord.email,
      nome: userRecord.displayName || defaultName || 'ElosCloud.Cliente',
      perfilPublico: false,
      dataCriacao: auth.firestore.FieldValue.serverTimestamp(),
      uid: userRecord.uid,
      tipoDeConta: 'Cliente',
      isOwnerOrAdmin: false,
      fotoDoPerfil: process.env.CLAUD_PROFILE_IMG,
      amigos: [],
      amigosAutorizados: [],
      conversasComMensagensNaoLidas: [],
    });

    batch.set(auth.firestore().doc(`conexoes/${userRecord.uid}/solicitadas/${process.env.CLAUD_PROFILE}`), {
      dataSolicitacao: auth.firestore.FieldValue.serverTimestamp(),
      nome: 'Claud Suporte',
      uid: process.env.CLAUD_PROFILE,
      status: 'pendente',
      fotoDoPerfil: process.env.CLAUD_PROFILE_IMG,
      descricao: 'Gostaria de conectar com você.',
      amigos: [],
    });

    try {
      await batch.commit();
    } catch (error) {
      throw new Error(`Erro ao criar perfil para o usuário: ${userRecord.email}`);
    }
  }
};

const facebookLogin = async (accessToken) => {
  const userData = await getFacebookUserData(accessToken);
  await ensureUserProfileExists(userData);
  return userData;
};

const registerWithEmail = async (email, password, inviteId) => {
  const inviteRef = await validateInvite(inviteId);
  const userRecord = await auth.createUser({ email, password });
  await sendEmailVerification(userRecord.uid);
  await ensureUserProfileExists(userRecord);
  await invalidateInvite(inviteId, email);

  const accessToken = generateToken({ uid: userRecord.uid });
  const refreshToken = generateRefreshToken({ uid: userRecord.uid });
  return { message: 'Conta criada com sucesso', accessToken, refreshToken };
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

const registerWithProvider = async (provider, inviteId) => {
  const inviteRef = await validateInvite(inviteId);
  let providerToUse;

  if (provider === 'google') {
    providerToUse = new GoogleAuthProvider();
    providerToUse.setCustomParameters({ prompt: 'select_account' });
  } else if (provider === 'microsoft') {
    providerToUse = new OAuthProvider('microsoft.com');
    providerToUse.setCustomParameters({ prompt: 'select_account' });
  }

  const userCredential = await signInWithPopup(auth, providerToUse);
  await ensureUserProfileExists(userCredential);
  await invalidateInvite(inviteId, userCredential.user.email);

  const accessToken = generateToken({ uid: userCredential.user.uid });
  const refreshToken = generateRefreshToken({ uid: userCredential.user.uid });
  return { message: 'Registro com provedor bem-sucedido', accessToken, refreshToken };
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