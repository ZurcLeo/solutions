//controllers/authController.js
const { logger } = require('../logger');
const { auth } = require('../firebaseAdmin');
const jwt = require('jsonwebtoken');
const { getFacebookUserData } = require('../services/facebookService');
const User = require('../models/User');
const Blacklist = require('../models/BlackList');
require('dotenv').config();

exports.getToken = async (req, res) => {
    const user = req.user; 
    const token = jwt.sign({ uid: user.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ token });
  };

exports.facebookLogin = async (req, res) => {
    const { accessToken } = req.body;

    try {
        const userData = await getFacebookUserData(accessToken);

        // Você pode salvar o usuário no seu banco de dados aqui
        res.status(200).json(userData);
    } catch (error) {
        console.error('Erro ao autenticar com Facebook:', error);
        res.status(500).json({ message: 'Erro ao autenticar com Facebook' });
    }
};

exports.registerWithEmail = async (req, res) => {
    const { email, password, inviteCode } = req.body;

    try {
        // Validar e invalidar o convite
        const inviteRef = await validateInvite(inviteCode);
        const userRecord = await auth.createUser({ email, password });
        await sendEmailVerification(userRecord.uid);
        await ensureUserProfileExists(userRecord);
        await invalidateInvite(inviteCode, email);

        const token = jwt.sign({ uid: userRecord.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({ message: 'Conta criada com sucesso', token });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar conta', error: error.message });
    }
};

exports.signInWithEmail = async (req, res) => {
    const { email, password } = req.body;

    try {
        const userRecord = await auth.getUserByEmail(email);
        const token = await auth.createCustomToken(userRecord.uid);

        if (!userRecord.emailVerified) {
            res.status(401).json({ message: 'Por favor, verifique seu e-mail.' });
            return;
        }

        await ensureUserProfileExists(userRecord);

        res.status(200).json({ message: 'Login bem-sucedido', token });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao fazer login', error: error.message });
    }
};

exports.logout = async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or invalid format' });
    }
  
    const idToken = authHeader.split(' ')[1];
    try {
      // Add token to blacklist
      await Blacklist.create({ token: idToken });
      res.status(200).json({ message: 'Logout successful and token blacklisted' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to blacklist token', error: error.message });
    }
  };

exports.signInWithProvider = async (req, res) => {
    const { idToken, provider } = req.body;
  
    if (typeof provider !== 'string' || !['google', 'facebook', 'microsoft'].includes(provider)) {
      return res.status(400).json({ message: 'Invalid provider' });
    }
  
    try {
      const decodedToken = await auth.verifyIdToken(idToken);
      const uid = decodedToken.uid;
      const userRecord = await auth.getUser(uid);
  
      const token = jwt.sign({ uid: userRecord.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
  
      if (!userRecord.emailVerified) {
        return res.status(401).json({ message: 'Por favor, verifique seu e-mail.' });
      }
  
      await ensureUserProfileExists(userRecord);
      res.status(200).json({ message: 'Login com provedor bem-sucedido', token, user: userRecord });
    } catch (error) {
      console.error('Error during provider sign-in:', error);
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  };

exports.registerWithProvider = async (req, res) => {
    const { provider, inviteCode } = req.body;

    try {
        const inviteRef = await validateInvite(inviteCode);

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
        await invalidateInvite(inviteCode, userCredential.user.email);

        const token = jwt.sign({ uid: userCredential.user.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({ message: 'Registro com provedor bem-sucedido', token });
    } catch (error) {
        res.status(500).json({ message: 'Erro no registro com provedor', error: error.message });
    }
};

exports.resendVerificationEmail = async (req, res) => {
    try {
        if (auth.currentUser) {
            await sendEmailVerification(auth.currentUser);
            res.status(200).json({ message: 'E-mail de verificação reenviado.' });
        }
    } catch (error) {
        logger.error(`Erro ao obter dados do usuário: ${error.message}`);
        res.status(500).json({ message: 'Erro ao reenviar e-mail de verificação', error: error.message });
    }
};

exports.getCurrentUser = async (req, res) => {
    try {
        // Decodifica o token JWT
        const decodedToken = await auth.verifyIdToken(req.headers.authorization.split(' ')[1]);
        // Obtém o UID do token decodificado
        const uid = decodedToken.uid;
        
        // Busca os dados básicos do usuário no Firebase Auth
        const userRecord = await auth.getUser(uid);
        
        // Busca os dados adicionais do usuário no Firestore
        const userProfile = await User.getById(uid);
        
        // Combina os dados básicos com os dados adicionais
        const userData = {
            uid: userRecord.uid,
            email: userRecord.email,
            emailVerified: userRecord.emailVerified,
            phoneNumber: userRecord.phoneNumber,
            displayName: userRecord.displayName,
            photoURL: userRecord.photoURL,
            providerData: userRecord.providerData,
            ...userProfile // Adiciona os dados do perfil do Firestore
        };
        
        // Retorna os dados do usuário
        logger.info(`Usuário autenticado: ${userRecord.email}`);
        res.status(200).json(userData);
    } catch (error) {
        logger.error(`Erro ao obter dados do usuário: ${error.message}`);
        res.status(500).json({ message: 'Erro ao obter dados do usuário', error: error.message });
    }
};

const getProviderInstance = (provider) => {
    switch (provider) {
      case 'google':
        return new firebase.auth.GoogleAuthProvider();
      case 'facebook':
        return new firebase.auth.FacebookAuthProvider();
      case 'microsoft':
        return new firebase.auth.OAuthProvider('microsoft.com');
      default:
        throw new Error(`Invalid provider: ${provider}`);
    }
  };

async function validateInvite(inviteCode) {
    const inviteRef = admin.firestore().doc(`convites/${inviteCode}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists || inviteSnap.data().status !== 'pending') {
        throw new Error('Convite inválido ou já utilizado.');
    }
    return inviteRef;
}

async function invalidateInvite(inviteId, email) {
    const functions = getFunctions();
    const invalidateInviteFunction = httpsCallable(functions, 'invalidateInvite');
    try {
        const result = await invalidateInviteFunction({ inviteId });
        if (!result.data.success) {
            throw new Error('Falha ao invalidar o convite.');
        }
    } catch (error) {
        throw new Error('Erro ao invalidar o convite.');
    }
}

async function ensureUserProfileExists(userRecord) {
    const userDocRef = admin.firestore().doc(`usuario/${userRecord.uid}`);
    const docSnap = await userDocRef.get();
  
    if (!docSnap.exists) {
      const batch = admin.firestore().batch();
      const email = userRecord.email;
      const defaultName = email.substring(0, email.indexOf('@'));
  
      batch.set(userDocRef, {
        email: userRecord.email,
        nome: userRecord.displayName || defaultName || 'ElosCloud.Cliente',
        perfilPublico: false,
        dataCriacao: admin.firestore.FieldValue.serverTimestamp(),
        uid: userRecord.uid,
        tipoDeConta: 'Cliente',
        isOwnerOrAdmin: false,
        fotoDoPerfil: process.env.CLAUD_PROFILE_IMG,
        amigos: [],
        amigosAutorizados: [],
        conversasComMensagensNaoLidas: [],
      });
  
      batch.set(admin.firestore().doc(`conexoes/${userRecord.uid}/solicitadas/${process.env.CLAUD_PROFILE}`), {
        dataSolicitacao: admin.firestore.FieldValue.serverTimestamp(),
        nome: 'Claud Suporte',
        uid: process.env.CLAUD_PROFILE,
        status: 'pendente',
        fotoDoPerfil: process.env.CLAUD_PROFILE_IMG,
        descricao: 'Gostaria de conectar com você.',
        amigos: [],
      });
  
      await batch.commit();
    }
  }