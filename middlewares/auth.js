const jwt = require('jsonwebtoken');
const {isTokenBlacklisted} = require('../services/blacklistService');
const {verifyAndGenerateNewToken} = require('../services/authService');

// authMiddleware.js - Verifica apenas autenticação
const verifyToken = async (req, res, next) => {
  let accessToken;
  let refreshToken;

  // Extrair token de acesso
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
  } else if (req.cookies && req.cookies.authorization) {
    // Extração de token de cookies formatados corretamente
    const cookieToken = req.cookies.authorization;
    if (cookieToken.startsWith('Bearer ')) {
      accessToken = cookieToken.substring(7);
    } else {
      accessToken = cookieToken;
    }
  } else {
    // Tentativa de extração de string de cookie
    const cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
      const match = cookieHeader.match(/authorization=Bearer\s([^;]+)/);
      if (match && match[1]) {
        accessToken = match[1];
      }
    }
  }

  // Extrair refresh token
  if (req.cookies && req.cookies.refreshToken) {
    refreshToken = req.cookies.refreshToken;
  }

  // Verificar se o token foi fornecido
  if (!accessToken) {
    return res.status(401).json({ isAuthenticated: false, message: 'Token não fornecido' });
  }

  try {
    // Primeiro verificar se o token está na blacklist
    const isBlacklisted = await isTokenBlacklisted(accessToken);
    if (isBlacklisted) {
      throw new Error('Token revogado');
    }
    
    // Verificar token
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    
    // Passar informações do usuário para o próximo middleware
    req.isFirstAccess = false;
    req.user = decoded;
    req.uid = decoded.uid;
    req.auth = { decoded };
    
    next();
  } catch (error) {
    // Tratamento específico por tipo de erro
    if (error.name === 'TokenExpiredError' && refreshToken) {
      handleRefreshToken(req, res, next, refreshToken);
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        isAuthenticated: false, 
        message: 'Token inválido', 
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else if (error.message === 'Token revogado') {
      return res.status(401).json({ 
        isAuthenticated: false, 
        message: 'Token revogado',
        requiresLogin: true
      });
    } else {
      return res.status(401).json({ 
        isAuthenticated: false, 
        message: 'Erro de autenticação', 
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

// Função auxiliar para tratar renovação do token
async function handleRefreshToken(req, res, next, refreshToken) {
  try {
    const newTokens = await verifyAndGenerateNewToken(refreshToken);
    
    // Configurar novos cookies
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
    
    // Decodificar novo token
    const newDecoded = jwt.verify(newTokens.accessToken, process.env.JWT_SECRET);
    
    // Passar informações atualizadas
    req.isFirstAccess = false;
    req.user = newDecoded;
    req.uid = newDecoded.uid;
    req.auth = { decoded: newDecoded };
    
    next();
  } catch (refreshError) {
    return res.status(401).json({ 
      isAuthenticated: false, 
      message: 'Erro ao renovar token',
      requiresLogin: true,
      error: process.env.NODE_ENV === 'development' ? refreshError.message : undefined
    });
  }
}

module.exports = verifyToken;