const { getAuth, getFirestore } = require('../firebaseAdmin');
const { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  OAuthProvider,
  signInWithCredential 
} = require('firebase/auth');
const { logger } = require('../logger');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getFacebookUserData } = require('./facebookService');
const { addToBlacklist, isTokenBlacklisted } = require('./blacklistService');
const { validateInvite, invalidateInvite } = require('./inviteService');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const providers = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: process.env.GOOGLE_CLIENT_ID,
    scope: 'email profile',
    responseType: 'code'
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    clientId: process.env.MICROSOFT_CLIENT_ID,
    scope: 'user.read email profile openid',
    responseType: 'code'
  }
};

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

// const initiateAuth = async (provider) => {
//   logger.info('Initiating authentication process', {
//     service: 'authService',
//     function: 'initiateAuth',
//     provider
//   });

//   try {
//     if (!providers[provider]) {
//       throw new Error('Invalid or unsupported provider');
//     }

//     const providerConfig = providers[provider];
//     const state = uuidv4();
    
//     // Store the state in Firestore for validation
//     const db = getFirestore();
//     await db.collection('authStates').doc(state).set({
//       provider,
//       createdAt: new Date(),
//       used: false,
//       expiresAt: new Date(Date.now() + 3600000) // 1 hour expiration
//     });

//     // Construct authentication URL
//     const redirectUri = process.env.NODE_ENV === 'production'
//       ? `${process.env.APP_URL}/api/auth/callback`
//       : 'http://localhost:9000/api/auth/callback';

//     const params = new URLSearchParams({
//       client_id: providerConfig.clientId,
//       redirect_uri: redirectUri,
//       response_type: providerConfig.responseType,
//       scope: providerConfig.scope,
//       state: state,
//       prompt: 'select_account'
//     });

//     const authUrl = `${providerConfig.authUrl}?${params.toString()}`;

//     logger.info('Authentication URL generated successfully', {
//       service: 'authService',
//       function: 'initiateAuth',
//       provider,
//       state
//     });

//     return {
//       authUrl,
//       state
//     };
//   } catch (error) {
//     logger.error('Error initiating authentication', {
//       service: 'authService',
//       function: 'initiateAuth',
//       provider,
//       error: error.message
//     });
//     throw error;
//   }
// };

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

const registerWithEmail = async (userData, inviteId) => {
  try {
    const { email, password, nome } = userData;

    // Validar convite
    const inviteRef = await validateInvite(inviteId);

    // Verificar se usuário já existe
    try {
      const existingUser = await auth.getUserByEmail(email);
      throw new Error('Email já registrado. Por favor, faça login.');
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    // Criar usuário
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: nome,
      emailVerified: false
    });

    // Enviar email de verificação
    const verificationLink = await auth.generateEmailVerificationLink(email);
    await sendEmailVerification(email, verificationLink);

    // Criar perfil do usuário
    await ensureUserProfileExists(userRecord);
    
    // Invalidar convite
    await invalidateInvite(inviteId, email);

    // Gerar tokens
    const accessToken = generateToken({ uid: userRecord.uid });
    const refreshToken = generateRefreshToken({ uid: userRecord.uid });

    logger.info('Usuário registrado com sucesso via email', {
      service: 'authService',
      method: 'registerWithEmail',
      userId: userRecord.uid
    });

    return {
      message: 'Conta criada com sucesso. Por favor, verifique seu email.',
      accessToken,
      refreshToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName
      }
    };
  } catch (error) {
    logger.error('Erro no registro com email', {
      service: 'authService',
      method: 'registerWithEmail',
      error: error.message
    });
    throw error;
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
  try {
    let credential;
    switch (provider) {
      case 'google':
        credential = GoogleAuthProvider.credential(idToken);
        break;
      case 'facebook':
        credential = FacebookAuthProvider.credential(idToken);
        break;
      case 'microsoft':
        credential = OAuthProvider.credential('microsoft.com', idToken);
        break;
      default:
        throw new Error('Provider não suportado');
    }

    const userCredential = await signInWithCredential(auth, credential);
    const user = userCredential.user;

    if (!user.emailVerified) {
      throw new Error('Por favor, verifique seu e-mail.');
    }

    await ensureUserProfileExists(user);
    const accessToken = generateToken({ uid: user.uid });
    const refreshToken = generateRefreshToken({ uid: user.uid });

    return { 
      message: 'Login com provedor bem-sucedido', 
      accessToken, 
      refreshToken, 
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      }
    };
  } catch (error) {
    logger.error('Erro no login com provedor', {
      service: 'authService',
      method: 'signInWithProvider',
      provider,
      error: error.message
    });
    throw error;
  }
};

const registerWithProvider = async (providerData, inviteId) => {
  try {
    const { provider, token } = providerData;
    
    const inviteRef = await validateInvite(inviteId);
    
    let credential;
    switch (provider) {
      case 'google':
        credential = GoogleAuthProvider.credential(token);
        break;
      case 'facebook':
        credential = FacebookAuthProvider.credential(token);
        break;
      case 'microsoft':
        credential = OAuthProvider.credential('microsoft.com', token);
        break;
      default:
        throw new Error('Provider não suportado');
    }

    const userCredential = await signInWithCredential(auth, credential);
    const user = userCredential.user;

    await ensureUserProfileExists(user);
    await invalidateInvite(inviteId, user.email);

    const accessToken = generateToken({ uid: user.uid });
    const refreshToken = generateRefreshToken({ uid: user.uid });

    logger.info('Usuário registrado com sucesso via provedor', {
      service: 'authService',
      method: 'registerWithProvider',
      provider,
      userId: user.uid
    });

    return {
      message: 'Registro com provedor bem-sucedido',
      accessToken,
      refreshToken,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      }
    };
  } catch (error) {
    logger.error('Erro no registro com provedor', {
      service: 'authService',
      method: 'registerWithProvider',
      error: error.message
    });
    throw error;
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

/**
 * Handles the authentication callback after Firebase Authentication
 * @param {string} idToken - The Firebase ID token to verify
 * @returns {Promise<Object>} Authentication result with user data and tokens
 */
const handleAuthCallback = async (idToken) => {
  logger.info('Processing Firebase authentication', {
    service: 'authService',
    function: 'handleAuthCallback'
  });

  try {
    // Verify the Firebase ID token
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken);

    // Get the user from Firebase Auth
    const firebaseUser = await auth.getUser(decodedToken.uid);

    // Prepare user data for Firestore
    const userData = {
      uid: firebaseUser.uid,
      nome: firebaseUser.displayName,
      email: firebaseUser.email,
      fotoDoPerfil: firebaseUser.photoURL,
      email_verified: firebaseUser.emailVerified,
      dataCriacao: firebaseUser.metadata.creationTime 
        ? new Date(firebaseUser.metadata.creationTime) 
        : new Date()
    };

    // Create or update user in Firestore
    await User.update(firebaseUser.uid, userData);

    // Generate custom token for session management
    const customToken = await auth.createCustomToken(firebaseUser.uid);

    return {
      success: true,
      tokens: {
        accessToken: customToken
      },
      user: userData
    };

  } catch (error) {
    logger.error('Error processing authentication', {
      service: 'authService',
      function: 'handleAuthCallback',
      error: error.message
    });
    throw error;
  }
};

/**
 * Validates the user's session token
 * @param {string} token - The session token to validate
 * @returns {Promise<Object>} Decoded token data
 */
const validateSession = async (token) => {
  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    logger.error('Session validation failed', {
      service: 'authService',
      function: 'validateSession',
      error: error.message
    });
    throw error;
  }
};

const exchangeCodeForTokens = async (code) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    throw new Error('Failed to exchange authorization code');
  }

  return response.json();
};

const fetchUserInfo = async (accessToken) => {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user information');
  }

  return response.json();
};

const generateApplicationTokens = async (userId) => {
  const accessToken = jwt.sign(
    { uid: userId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const refreshToken = jwt.sign(
    { uid: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

module.exports = {
  verifyIdToken,
  // initiateAuth,
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
  handleAuthCallback,
  exchangeCodeForTokens,
  generateApplicationTokens,
  fetchUserInfo,
  validateSession
};