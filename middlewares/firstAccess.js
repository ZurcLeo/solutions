// firstAccessMiddleware.js
const { getAuth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const FirestoreService = require('../utils/firestoreService');
const dbServiceUser = FirestoreService.collection('usuario');
const { calculateJA3Hash } = require('../services/ja3Service');
const { initializeFirstAdmin } = require('../config/scripts/initializeLocalData');

const firstAccess = async (req, res, next) => {
  // Só verificar se o token foi fornecido
  if (!req.body.firebaseToken) {
    return next();
  }

  try {
    // Verificar o token do Firebase
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(req.body.firebaseToken);
    const userId = decodedToken.uid;

    let fingerPrintRawData = req.headers['x-browser-fingerprint'] ? 
      JSON.parse(req.headers['x-browser-fingerprint']) : 
      req.body.ja3Data || null;
    
    // Preparar os dados de fingerprint
    const fingerPrintData = fingerPrintRawData ? {
      version: fingerPrintRawData.version || fingerPrintRawData.userAgent || '',
      cipherSuites: fingerPrintRawData.cipherSuites || [],
      extensions: fingerPrintRawData.extensions || [],
      ellipticCurves: fingerPrintRawData.ellipticCurves || [],
      ellipticCurvePointFormats: fingerPrintRawData.ellipticCurvePointFormats || [],
      userId: userId
    } : null;

    if (fingerPrintData && isValidFingerPrintData(fingerPrintData)) {
      try {
        const { ja3Hash } = await calculateJA3Hash(fingerPrintData);
        // Armazenar o JA3 hash no objeto req para uso posterior
        req.ja3Hash = ja3Hash;
        logger.info('JA3 hash calculado e armazenado na requisição', { userId, ja3Hash });
      } catch (ja3Error) {
        logger.error('Erro ao calcular JA3 hash', { userId, error: ja3Error.message });
      }
    }

    // Verificar se o usuário já existe
    try {
      const userDoc = await dbServiceUser.doc(userId).get();
      
      if (!userDoc.exists) {
        // Novo usuário - marcar como primeiro acesso
        req.isFirstAccess = true;
      } else {
        // Usuário existente
        req.isFirstAccess = false;
        
        // Obter dados do usuário
        const userData = userDoc.data();
        
        // Inicializar primeiro admin se aplicável
        if (userData && userData.email) {
          await initializeFirstAdmin(userData.email);
        }
        
        // Verificar se o usuário tem o campo 'roles' e o injeta na requisição
        if (userData && userData.roles) {
          req.userRoles = userData.roles;
        }
      }
      
      // Se não tiver roles, inicializa com um objeto vazio
      if (!req.userRoles) {
        req.userRoles = {};
      }

      // Adiciona funções de helpers para verificação rápida
      req.hasRole = (roleName, contextType = 'global', resourceId = null) => {
        const { roles } = require('../config/data/initialData');
        
        for (const roleId in req.userRoles) {
          const userRole = req.userRoles[roleId];
          const roleData = roles[roleId];
          
          if (!roleData || roleData.name !== roleName || userRole.validationStatus !== 'validated') {
            continue;
          }
          
          // Verificações de contexto se não for global
          if (contextType !== 'global') {
            if (userRole.context.type !== contextType) {
              continue;
            }
            
            if (resourceId && userRole.context.resourceId !== resourceId) {
              continue;
            }
          }
          
          return true;
        }
        
        return false;
      };

      req.hasPermission = (permissionName, contextType = 'global', resourceId = null) => {
        const { roles, permissions, rolePermissions } = require('../config/data/initialData');
        
        for (const roleId in req.userRoles) {
          const userRole = req.userRoles[roleId];
          
          if (userRole.validationStatus !== 'validated') {
            continue;
          }
          
          // Verificações de contexto se não for global
          if (contextType !== 'global') {
            if (userRole.context.type !== contextType) {
              continue;
            }
            
            if (resourceId && userRole.context.resourceId !== resourceId) {
              continue;
            }
          }
          
          // Verifica permissões para esta role
          const rolePerms = Object.values(rolePermissions)
            .filter(rp => rp.roleId === roleId)
            .map(rp => rp.permissionId);
          
          // Verifica se alguma das permissões corresponde
          const hasPermission = rolePerms.some(permId => {
            return permissions[permId]?.name === permissionName;
          });
          
          if (hasPermission) {
            return true;
          }
        }
        
        return false;
      };
      
      return next();
    } catch (error) {
      logger.error('Erro ao verificar usuário', {
        userId,
        error: error.message
      });
      return next(error);
    }
  } catch (tokenError) {
    logger.error('Erro ao verificar token', {
      error: tokenError.message
    });
    return next();
  }
};

// Função auxiliar para verificar se os dados de fingerprint são válidos
function isValidFingerPrintData(data) {
  return (
    data.version && 
    Array.isArray(data.cipherSuites) && data.cipherSuites.length > 0 &&
    Array.isArray(data.extensions) && 
    Array.isArray(data.ellipticCurves) && 
    Array.isArray(data.ellipticCurvePointFormats) &&
    data.userId
  );
}

module.exports = firstAccess;