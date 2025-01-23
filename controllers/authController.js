// controllers/authController.js
const { logger } = require('../logger');
const authService = require('../services/authService');
const User = require('../models/User');

exports.getToken = async (req, res) => {
  const userId = req.user.uid;
  try {
    const { accessToken, refreshToken } = await authService.generateTokens(userId);
    res.status(200).json({ accessToken, refreshToken });
  } catch (error) {
    logger.error('Erro ao gerar token JWT', { service: 'authController', function: 'getToken', error: error.message });
    res.status(500).json({ message: 'Erro ao gerar token', error: error.message });
  }
};

exports.facebookLogin = async (req, res) => {
  const { accessToken } = req.body;

  try {
    const userData = await authService.facebookLogin(accessToken);
    res.status(200).json(userData);
  } catch (error) {
    logger.error('Erro ao autenticar com Facebook', { service: 'authController', function: 'facebookLogin', error: error.message });
    res.status(500).json({ message: 'Erro ao autenticar com Facebook', error: error.message });
  }
};

exports.registerWithEmail = async (req, res) => {
  const { email, password, nome, inviteId } = req.body;

  try {
    // Validar dados necessários
    if (!email || !password || !nome || !inviteId) {
      return res.status(400).json({
        message: 'Dados incompletos para registro',
        details: 'Email, senha, nome e inviteId são obrigatórios'
      });
    }

    logger.info('Iniciando registro com email', {
      service: 'authController',
      function: 'registerWithEmail',
      email
    });

    const userData = { email, password, nome };
    const response = await authService.registerWithEmail(userData, inviteId);

    // Configurar cookies seguros
    res.cookie('refreshToken', response.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
    });

    // Enviar resposta sem expor tokens sensíveis
    res.status(200).json({
      message: response.message,
      user: response.user,
      accessToken: response.accessToken
    });

  } catch (error) {
    logger.error('Erro no registro com email', {
      service: 'authController',
      function: 'registerWithEmail',
      error: error.message
    });

    // Tratamento específico de erros
    if (error.message.includes('já registrado')) {
      return res.status(409).json({
        message: 'Email já registrado',
        error: error.message
      });
    }

    if (error.message.includes('convite')) {
      return res.status(400).json({
        message: 'Erro com o convite',
        error: error.message
      });
    }

    if (error.message.includes('senha')) {
      return res.status(400).json({
        message: 'Erro com a senha',
        error: error.message
      });
    }

    res.status(500).json({
      message: 'Erro interno no registro',
      error: error.message
    });
  }
};

exports.signInWithEmail = async (req, res) => {
  const { email, password } = req.body;

  try {
    const response = await authService.signInWithEmail(email, password);
    res.status(200).json(response);
  } catch (error) {
    logger.error('Erro ao fazer login', { service: 'authController', function: 'signInWithEmail', error: error.message });
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
    await authService.logout(idToken);
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
    const response = await authService.signInWithProvider(idToken, provider);
    res.status(200).json(response);
  } catch (error) {
    logger.error('Erro durante o login com provedor', { service: 'authController', function: 'signInWithProvider', error: error.message });
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

exports.registerWithProvider = async (req, res) => {
  const { provider, token, inviteId } = req.body;

  try {
    // Validar dados necessários
    if (!provider || !token || !inviteId) {
      return res.status(400).json({ 
        message: 'Dados incompletos para registro',
        details: 'Provider, token e inviteId são obrigatórios'
      });
    }

    // Validar provedor
    if (!['google', 'microsoft'].includes(provider)) {
      return res.status(400).json({ 
        message: 'Provedor inválido',
        details: 'Provedores aceitos: google, microsoft'
      });
    }

    logger.info('Iniciando registro com provedor', { 
      service: 'authController',
      function: 'registerWithProvider',
      provider,
      inviteId
    });

    const providerData = { provider, token };
    const response = await authService.registerWithProvider(providerData, inviteId);

    // Configurar cookies seguros
    res.cookie('refreshToken', response.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
    });

    // Enviar resposta sem expor tokens sensíveis
    res.status(200).json({
      message: response.message,
      user: response.user,
      accessToken: response.accessToken
    });

  } catch (error) {
    logger.error('Erro no registro com provedor', { 
      service: 'authController',
      function: 'registerWithProvider',
      error: error.message 
    });

    // Tratamento específico de erros
    if (error.message.includes('já registrado')) {
      return res.status(409).json({
        message: 'Usuário já registrado',
        error: error.message
      });
    }

    if (error.message.includes('convite')) {
      return res.status(400).json({
        message: 'Erro com o convite',
        error: error.message
      });
    }

    res.status(500).json({ 
      message: 'Erro interno no registro',
      error: error.message 
    });
  }
};

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
    const userId = req.uid;
    if (!userId) {
      throw new Error('ID do usuário não encontrado no request.');
    }

    logger.info('userId no getCurrentUser:', { service: 'authController', function: 'getCurrentUser', userId });
    const userData = await authService.getCurrentUser(userId);

    logger.info('UserData no getCurrentUser: ', userData);
    res.status(200).json(userData);
  } catch (error) {
    logger.error(`Erro ao obter dados do usuário: ${error.message}`);
    res.status(500).json({ message: 'Erro ao obter dados do usuário', error: error.message });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

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
  try {
    const { code, state } = req.query;
    const result = await authService.handleAuthCallback(code, state);
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      // Produção: Apenas cookies seguros
      res.cookie('accessToken', result.tokens.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: process.env.DOMAIN,
        maxAge: 3600000
      });
      
      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: process.env.DOMAIN,
        maxAge: 86400000
      });

      res.redirect(`${process.env.FRONTEND_URL}/auth/callback`);
    } else {
      // Desenvolvimento: Tokens no corpo da resposta
      res.status(200).json({
        success: true,
        tokens: result.tokens,
        user: result.user
      });
    }
  } catch (error) {
    const errorRedirect = isProd 
      ? `${process.env.FRONTEND_URL}/auth/error?message=${encodeURIComponent(error.message)}`
      : { success: false, error: error.message };
    
    isProd ? res.redirect(errorRedirect) : res.status(500).json(errorRedirect);
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
      return res.status(400).json({ message: 'ID do usuário não fornecido' });
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