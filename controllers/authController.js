// controllers/authController.js
const { logger } = require('../logger');
const { auth } = require('../firebaseAdmin');
const jwt = require('jsonwebtoken');
const { getFacebookUserData } = require('../services/facebookService');
const User = require('../models/User');
const { addToBlacklist } = require('../services/blacklistService');
require('dotenv').config();

/**
 * Gera um token JWT para um usuário autenticado.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} res - Resposta HTTP.
 * @returns {Object} - Resposta com o token JWT.
 *  *
 * @description
 * Esta função gera um token JWT para um usuário autenticado.
 */
exports.getToken = async (req, res) => {
  const user = req.user; 
  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.status(200).json({ token });
};

/**
 * Autentica um usuário usando o Facebook.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.body - Corpo da requisição.
 * @param {string} req.body.accessToken - Token de acesso do Facebook.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de autenticação é concluído.
 * 
 * @description
 * Esta função autentica um usuário usando o token de acesso do Facebook. O processo inclui obter
 * os dados do usuário do Facebook e garantir que o perfil do usuário exista no sistema. Em caso
 * de sucesso, os dados do usuário são retornados na resposta. Em caso de erro, uma mensagem de erro
 * é registrada e retornada na resposta.
 */
exports.facebookLogin = async (req, res) => {
    const { accessToken } = req.body;

    try {
        const userData = await getFacebookUserData(accessToken);
        await ensureUserProfileExists(userData);

        res.status(200).json(userData);
    } catch (error) {
        console.error('Erro ao autenticar com Facebook:', error);
        res.status(500).json({ message: 'Erro ao autenticar com Facebook' });
    }
};

/**
 * Registra um novo usuário com email e senha.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.body - Corpo da requisição.
 * @param {string} req.body.email - Email do usuário.
 * @param {string} req.body.password - Senha do usuário.
 * @param {string} req.body.inviteCode - Código de convite (opcional).
 * @returns {Promise<User>} - Promessa que resolve com o usuário registrado.
 * 
 * @description
 * Esta função registra um novo usuário com email e senha. Se um código de convite for fornecido,
 * o usuário será registrado com o convite associado.
 */
exports.registerWithEmail = async (req, res) => {
  const { email, password, inviteCode } = req.body;

try {
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
}

/**
 * Autentica um usuário usando email e senha.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.body - Corpo da requisição.
 * @param {string} req.body.email - Email do usuário.
 * @param {string} req.body.password - Senha do usuário.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de autenticação é concluído.
 * 
 * @description
 * Esta função autentica um usuário usando email e senha. O processo inclui:
 * 1. Buscar o registro do usuário pelo email.
 * 2. Criar um token personalizado para o usuário.
 * 3. Verificar se o email do usuário foi verificado.
 * 4. Garantir que o perfil do usuário exista no sistema.
 * Em caso de sucesso, um token de autenticação e uma mensagem de sucesso são retornados na resposta.
 * Em caso de erro, uma mensagem de erro é retornada na resposta.
 */
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

/**
 * Realiza o logout do usuário e adiciona o token à lista negra.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.headers - Cabeçalhos da requisição.
 * @param {string} req.headers.authorization - Cabeçalho de autorização contendo o token.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de logout é concluído.
 * 
 * @description
 * Esta função realiza o logout do usuário. O processo inclui:
 * 1. Verificar a presença e o formato do token de autorização no cabeçalho.
 * 2. Extrair o token de autorização.
 * 3. Adicionar o token à lista negra para que não possa mais ser utilizado.
 * Em caso de sucesso, uma mensagem de sucesso é retornada na resposta.
 * Em caso de erro, uma mensagem de erro é retornada na resposta.
 */
exports.logout = async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or invalid format' });
    }
  
    const idToken = authHeader.split(' ')[1];
    try {
      await addToBlacklist(idToken);
      res.status(200).json({ message: 'Logout successful and token blacklisted' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to blacklist token', error: error.message });
    }
};

/**
 * Autentica um usuário usando um provedor externo (Google, Facebook, Microsoft).
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.body - Corpo da requisição.
 * @param {string} req.body.idToken - Token de identificação do provedor.
 * @param {string} req.body.provider - Nome do provedor (google, facebook, microsoft).
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de autenticação é concluído.
 * 
 * @description
 * Esta função autentica um usuário usando um token de identificação de um provedor externo.
 * O processo inclui:
 * 1. Verificar se o provedor fornecido é válido.
 * 2. Verificar e decodificar o token de identificação do provedor.
 * 3. Buscar o registro do usuário com base no UID decodificado.
 * 4. Criar um token JWT personalizado para o usuário.
 * 5. Verificar se o email do usuário foi verificado.
 * 6. Garantir que o perfil do usuário exista no sistema.
 * Em caso de sucesso, um token de autenticação e os dados do usuário são retornados na resposta.
 * Em caso de erro, uma mensagem de erro é retornada na resposta.
 */
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

/**
 * Registra um usuário usando um provedor externo (Google, Microsoft) e um código de convite.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.body - Corpo da requisição.
 * @param {string} req.body.provider - Nome do provedor (google, microsoft).
 * @param {string} req.body.inviteCode - Código de convite.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de registro é concluído.
 * 
 * @description
 * Esta função registra um usuário usando um provedor externo e um código de convite.
 * O processo inclui:
 * 1. Validar o código de convite.
 * 2. Determinar o provedor a ser usado com base no parâmetro `provider`.
 * 3. Autenticar o usuário com o provedor externo através de um popup.
 * 4. Garantir que o perfil do usuário exista no sistema.
 * 5. Invalidar o código de convite após o uso.
 * 6. Criar um token JWT personalizado para o usuário.
 * Em caso de sucesso, um token de autenticação e uma mensagem de sucesso são retornados na resposta.
 * Em caso de erro, uma mensagem de erro é retornada na resposta.
 */
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

/**
 * Reenvia o e-mail de verificação para o usuário autenticado.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de reenvio do e-mail de verificação é concluído.
 * 
 * @description
 * Esta função reenvia o e-mail de verificação para o usuário atualmente autenticado. 
 * O processo inclui:
 * 1. Verificar se há um usuário autenticado.
 * 2. Reenviar o e-mail de verificação para o usuário autenticado.
 * Em caso de sucesso, uma mensagem de sucesso é retornada na resposta.
 * Em caso de erro, uma mensagem de erro é registrada e retornada na resposta.
 */
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

/**
 * Obtém os dados do usuário autenticado.
 * 
 * @param {Object} req - Requisição HTTP.
 * @param {Object} req.headers - Cabeçalhos da requisição.
 * @param {string} req.headers.authorization - Cabeçalho de autorização contendo o token.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise<void>} - Promessa que resolve quando o processo de obtenção dos dados do usuário é concluído.
 * 
 * @description
 * Esta função obtém os dados do usuário atualmente autenticado. O processo inclui:
 * 1. Verificar e decodificar o token de identificação do usuário.
 * 2. Buscar o registro do usuário com base no UID decodificado.
 * 3. Buscar o perfil do usuário a partir do banco de dados.
 * 4. Combinar os dados do usuário do registro de autenticação com os dados do perfil do banco de dados.
 * Em caso de sucesso, os dados do usuário são retornados na resposta.
 * Em caso de erro, uma mensagem de erro é registrada e retornada na resposta.
 */
exports.getCurrentUser = async (req, res) => {
    try {
        const decodedToken = await auth.verifyIdToken(req.headers.authorization.split(' ')[1]);
        const uid = decodedToken.uid;
        
        const userRecord = await auth.getUser(uid);
        const userProfile = await User.getById(uid);
        
        const userData = {
            uid: userRecord.uid,
            email: userRecord.email,
            emailVerified: userRecord.emailVerified,
            phoneNumber: userRecord.phoneNumber,
            displayName: userRecord.displayName,
            photoURL: userRecord.photoURL,
            providerData: userRecord.providerData,
            ...userProfile
        };
        
        logger.info(`Usuário autenticado: ${userRecord.email}`);
        res.status(200).json(userData);
    } catch (error) {
        logger.error(`Erro ao obter dados do usuário: ${error.message}`);
        res.status(500).json({ message: 'Erro ao obter dados do usuário', error: error.message });
    }
};

/**
 * Retorna uma instância do provedor de autenticação com base no nome do provedor.
 * 
 * @param {string} provider - Nome do provedor (google, facebook, microsoft).
 * @returns {Object} - Instância do provedor de autenticação.
 * @throws {Error} - Lança um erro se o provedor for inválido.
 * 
 * @description
 * Esta função retorna uma instância apropriada do provedor de autenticação com base no nome do provedor fornecido.
 * Os provedores suportados são:
 * 1. Google
 * 2. Facebook
 * 3. Microsoft
 * Se um provedor inválido for fornecido, a função lançará um erro.
 */
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

/**
 * Valida um código de convite.
 * 
 * @param {string} inviteCode - Código de convite a ser validado.
 * @returns {Promise<Object>} - Promessa que resolve com a referência do documento de convite se o convite for válido.
 * @throws {Error} - Lança um erro se o convite for inválido ou já utilizado.
 * 
 * @description
 * Esta função valida um código de convite verificando se ele existe e se seu status é 'pending'.
 * Se o convite for válido, a referência do documento de convite é retornada.
 * Caso contrário, um erro é lançado indicando que o convite é inválido ou já foi utilizado.
 */
async function validateInvite(inviteCode) {
    const inviteRef = admin.firestore().doc(`convites/${inviteCode}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists || inviteSnap.data().status !== 'pending') {
        throw new Error('Convite inválido ou já utilizado.');
    }
    return inviteRef;
}

/**
 * Invalida um código de convite.
 * 
 * @param {string} inviteId - ID do convite a ser invalidado.
 * @param {string} email - Email do usuário que usou o convite.
 * @returns {Promise<void>} - Promessa que resolve quando o convite é invalidado com sucesso.
 * @throws {Error} - Lança um erro se a invalidação do convite falhar.
 * 
 * @description
 * Esta função invalida um código de convite chamando uma função HTTPS na nuvem.
 * O processo inclui:
 * 1. Obter uma referência às funções HTTPS do Firebase.
 * 2. Chamar a função 'invalidateInvite' passando o ID do convite.
 * 3. Verificar o resultado e lançar um erro se a invalidação falhar.
 */
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

/**
 * Garante que o perfil do usuário exista no Firestore e adiciona logging para monitorar a criação de perfis.
 * 
 * @param {Object} userRecord - Registro do usuário autenticado.
 * @param {string} userRecord.uid - ID do usuário.
 * @param {string} userRecord.email - Email do usuário.
 * @param {string} [userRecord.displayName] - Nome de exibição do usuário.
 * @returns {Promise<void>} - Promessa que resolve quando o perfil do usuário é criado ou confirmado que já existe.
 * 
 * @description
 * Esta função verifica se o perfil do usuário existe no Firestore e, se não existir, cria um novo perfil com dados padrão.
 * O processo inclui:
 * 1. Obter a referência do documento do usuário no Firestore.
 * 2. Verificar se o documento do usuário já existe.
 * 3. Se o documento não existir:
 *    - Preparar um lote de operações para criar o perfil do usuário.
 *    - Definir os dados padrão do perfil do usuário, incluindo email, nome, perfil público, data de criação, tipo de conta, etc.
 *    - Adicionar uma solicitação de conexão padrão para o suporte do Claud.
 *    - Executar o lote de operações para salvar os dados no Firestore.
 * 4. Adicionar logging para monitorar a criação de perfis de usuários.
 */

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
      
      try {
          await batch.commit();
          logger.info(`Perfil criado para o usuário: ${userRecord.email}`);
      } catch (error) {
          logger.error(`Erro ao criar perfil para o usuário: ${userRecord.email} - ${error.message}`);
          throw new Error(`Erro ao criar perfil para o usuário: ${userRecord.email}`);
      }
  } else {
      logger.info(`Perfil já existe para o usuário: ${userRecord.email}`);
  }
}