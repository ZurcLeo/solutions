//controllers/authController.js
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const jwt = require('jsonwebtoken');
const { getFacebookUserData } = require('../services/facebookService');

const auth = getAuth();

exports.getToken = (req, res) => {
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
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        await auth.revokeRefreshTokens(token);
        res.status(200).json({ message: 'Usuário deslogado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deslogar usuário', error: error.message });
    }
};

exports.signInWithProvider = async (req, res) => {
    const { idToken, provider } = req.body; 

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        const uid = decodedToken.uid; 
        const userRecord = await auth.getUser(uid);

        const token = jwt.sign({ uid: userRecord.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
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
        res.status(500).json({ message: 'Erro ao reenviar e-mail de verificação', error: error.message });
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