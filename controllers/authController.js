// controllers/authController.js
const { getAuth } = require('../firebaseAdmin');
const jwt = require('jsonwebtoken');
const authService = require('../services/authService');
const inviteService = require('../services/inviteService')
const userService = require('../services/userService');
const { generateToken, generateRefreshToken } = require('../services/authService');
const { logger } = require('../logger');
const User = require('../models/User');

// authController.js - checkSession modificado
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
        email: user.email
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

exports.getToken = async (req, res) => {
  try {
    const { firebaseToken } = req.body;
    
    if (!firebaseToken) {
      return res.status(400).json({
        success: false,
        message: 'Token do Firebase não fornecido'
      });
    }
    
    // Verificar o token do Firebase
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(firebaseToken);
    const userId = decodedToken.uid;
    
    // Verificar se é o primeiro acesso (usando flag definida pelo middleware)
    const isFirstAccess = req.isFirstAccess || false;
    
    // Buscar dados do usuário (ou usar dados básicos se for primeiro acesso)
    let user;
    if (isFirstAccess) {
      // Se for primeiro acesso, usar dados básicos do token
      user = {
        uid: userId,
        email: decodedToken.email,
        nome: decodedToken.name || decodedToken.email.split('@')[0],
        emailVerified: decodedToken.email_verified || false,
      };
    } else {
      // Buscar usuário completo do banco
      user = await User.getById(userId);
    }
    
    // Gerar tokens JWT
    const tokens = authService.generateToken({
      uid: userId,
      email: decodedToken.email
    });
    
    // Salvar tokens (usando AuthTokenService se disponível)
    // const authTokenService = serviceLocator.get('authToken');
    // if (authTokenService && authTokenService.isInitialized) {
    //   authTokenService.setTokens(
    //     tokens.accessToken,
    //     tokens.refreshToken,
    //     tokens.expiresIn || 3600
    //   );
    // }
    
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
    
    return res.status(200).json({
      success: true,
      isAuthenticated: true,
      isFirstAccess: isFirstAccess,
      user: user,
      tokens: tokens
    });
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

exports.register = async (req, res) => {
  const auth = getAuth();
  const ja3Hash = req.ja3Hash;
  const { firebaseToken, inviteId, profileData } = req.body;
  
  try {
    // 1. Verificar o token do Firebase
    const decodedToken = await auth.verifyIdToken(firebaseToken);
    const userId = decodedToken.uid;
    // const ja3hash = calculateJA3Hash(req.)

    // 3. Criar ou atualizar perfil do usuário
    const userData = {
      uid: userId,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      ja3Hash,
      ...profileData,
      dataCriacao: Date.now()
    };
    
    const user = await userService.addUser(userData);
    
    // 2. Verificar e invalidar o convite (se fornecido)
    if (inviteId) {
      await inviteService.invalidateInvite(inviteId, userId);
    }

    // 4. Gerar token JWT da aplicação
    const tokens = authService.generateToken({
      uid: userId,
      email: decodedToken.email
    });
    
    // 5. Definir cookies de autenticação
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
      tokens
    });
  } catch (error) {
    logger.error('Erro no registro', {
      error: error.message,
      inviteId,
      profileData
    });
    
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

exports.resendVerificationEmail = async (req, res) => {
  try {
    const response = await authService.resendVerificationEmail();
    res.status(200).json(response);
  } catch (error) {
    logger.error(`Erro ao reenviar email de verificação: ${error.message}`);
    res.status(500).json({ message: 'Erro ao reenviar email de verificação', error: error.message });
  }
};

exports.getCurrentUser = async (req, res) => {
  try {
    // O userId já deve vir do token decodificado, não precisa ser da rota
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userId = req.user.uid; // Obtendo diretamente do token, sem usar params

    // O código abaixo verifica se a rota é '/me', mas isso não é necessário, pois já sabemos que é o usuário autenticado
    logger.info('Requisição para obter usuário autenticado', { service: 'userController', function: 'getCurrentUser', userId });
    const user = await authService.getUserById(userId); // Ou diretamente usar UserModel.getById
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

// Iniciar processo de autenticação com provedores externos
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

// Iniciar processo de registro com provedores externos
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

// Tratar retorno da autenticação
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

// Verificar validade da sessão
exports.checkSession = async (req, res) => {
  const userId = req.user?.uid;
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ valid: false, message: 'No token provided' });
  }

  try {
    if (!userId) {
      return res.status(400).json({ message: 'ID do usuário não fornecido 1' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.uid !== userId) {
      return res.status(401).json({ message: 'Sessão inválida ou expirada' });
    }

    res.status(200).json({ message: 'Sessão válida' });
  } catch (error) {
    logger.error('Erro ao verificar sessão', { service: 'authController', function: 'checkSession', error: error.message });
    res.status(500).json({ message: 'Erro ao verificar sessão', error: error.message });
  }
};

// Verificar token de redefinição de senha
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