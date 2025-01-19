// controllers/authController.js
const { logger } = require('../logger');
const authService = require('../services/authService');

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
  const { email, password, inviteId } = req.body;

  try {
    const response = await authService.registerWithEmail(email, password, inviteId);
    res.status(200).json(response);
  } catch (error) {
    logger.error('Erro ao criar conta', { service: 'authController', function: 'registerWithEmail', error: error.message });
    res.status(500).json({ message: 'Erro ao criar conta', error: error.message });
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
  const { provider, inviteId, email, nome } = req.body;

  try {
    const response = await authService.registerWithProvider(provider, inviteId, email);
    res.status(200).json(response);
  } catch (error) {
    logger.error('Erro no registro com provedor', { service: 'authController', function: 'registerWithProvider', error: error.message });
    res.status(500).json({ message: 'Erro no registro com provedor', error: error.message });
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
    const userId = req.uid; // `req.uid` é definido pelo middleware de autenticação
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