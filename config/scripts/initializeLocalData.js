// scripts/initializeLocalStorage.js
const { getFirestore } = require('../../firebaseAdmin');
const { logger } = require('../../logger');
const LocalStorageService = require('../../services/LocalStorageService');
const { roles } = require('../data/initialData');
const { permissions } = require('../data/initialData');
const { rolePermissions } = require('../data/initialData');

const db = getFirestore();

/**
 * Inicializa os dados locais para o RBAC
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function initializeLocalStorage() {
  try {
    logger.info('Iniciando inicialização de dados locais', {
      service: 'initializeLocalStorage'
    });

    // Salvar roles
    const rolesCollection = LocalStorageService.collection('roles');
    await rolesCollection._saveData(roles);
    
    // Salvar permissões
    const permissionsCollection = LocalStorageService.collection('permissions');
    await permissionsCollection._saveData(permissions);
    
    // Salvar associações
    const rolePermissionsCollection = LocalStorageService.collection('role_permissions');
    await rolePermissionsCollection._saveData(rolePermissions);
    
    logger.info('Dados locais inicializados com sucesso', {
      service: 'initializeLocalStorage',
      rolesCount: Object.keys(roles).length,
      permissionsCount: Object.keys(permissions).length,
      rolePermissionsCount: Object.keys(rolePermissions).length
    });
    
    return true;
  } catch (error) {
    logger.error('Erro ao inicializar dados locais', {
      service: 'initializeLocalStorage',
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Inicializa o primeiro usuário admin
 * @param {string} email - Email do admin
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function initializeFirstAdmin(email) {
  try {
    // Verificar se email foi fornecido
    if (!email) {
      logger.warn('Email não fornecido para inicialização do usuário', {
        service: 'initializeFirstAdmin'
      });
      return false;
    }
    
    logger.info('Iniciando inicialização do usuário', {
      service: 'initializeFirstAdmin',
      email
    });
    
    // Buscar o usuário pelo email
    const usersSnapshot = await db.collection('usuario')
      .where('email', '==', email)
      .limit(1)
      .get();
    
    if (usersSnapshot.empty) {
      logger.warn('Usuário não encontrado pelo email fornecido', {
        service: 'initializeFirstAdmin',
        email
      });
      return false;
    }
    
    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    // Preparar a atualização
    const updateData = {};
    
    // Decidir qual role atribuir baseado no status atual
    if (userData.isOwnerOrAdmin === true) {
      // Se já é admin no sistema legado, atribuir role de admin no novo sistema
      const adminRoleData = roles['admin'];
      
      if (!adminRoleData) {
        throw new Error('Role admin não encontrada nas definições');
      }
      
      // Criar ou atualizar a estrutura de roles
      if (!userData.roles) {
        // Se não tem roles, criar objeto completo
        updateData.roles = {
          admin: {
            roleId: 'admin',
            context: { type: 'global', resourceId: null },
            validationStatus: 'validated',
            assignedAt: new Date().toISOString(),
            metadata: { migratedFromLegacyAdmin: true }
          }
        };
      } else {
        // Se já tem roles, adicionar apenas a nova role usando notação de ponto
        updateData['roles.admin'] = {
          roleId: 'admin',
          context: { type: 'global', resourceId: null },
          validationStatus: 'validated',
          assignedAt: new Date().toISOString(),
          metadata: { migratedFromLegacyAdmin: true }
        };
      }
      
      logger.info('Migrando admin legado para nova role de admin', {
        service: 'initializeFirstAdmin',
        userId,
        email
      });
    } else {
      // Se não é admin, atribuir role de client por padrão
      const clientRoleData = roles['client'];
      
      if (!clientRoleData) {
        throw new Error('Role client não encontrada nas definições');
      }
      
      // Criar ou atualizar a estrutura de roles
      if (!userData.roles) {
        // Se não tem roles, criar objeto completo
        updateData.roles = {
          client: {
            roleId: 'client',
            context: { type: 'global', resourceId: null },
            validationStatus: 'validated',
            assignedAt: new Date().toISOString(),
            metadata: { initialRegistration: true }
          }
        };
      } else {
        // Se já tem roles, adicionar apenas a nova role usando notação de ponto
        updateData['roles.client'] = {
          roleId: 'client',
          context: { type: 'global', resourceId: null },
          validationStatus: 'validated',
          assignedAt: new Date().toISOString(),
          metadata: { initialRegistration: true }
        };
      }
      
      logger.info('Atribuindo role client para novo usuário', {
        service: 'initializeFirstAdmin',
        userId,
        email
      });
    }
    
    // Aplicar as atualizações apenas se houver algo para atualizar
    if (Object.keys(updateData).length > 0) {
      await db.collection('usuario').doc(userId).update(updateData);
      
      logger.info('Roles do usuário atualizadas com sucesso', {
        service: 'initializeFirstAdmin',
        userId,
        email,
        updateFields: Object.keys(updateData)
      });
    } else {
      logger.info('Nenhuma atualização necessária para o usuário', {
        service: 'initializeFirstAdmin',
        userId,
        email
      });
    }
    
    return true;
  } catch (error) {
    logger.error('Erro ao inicializar usuário', {
      service: 'initializeFirstAdmin',
      email,
      error: error.message
    });
    return false;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  initializeLocalStorage()
    .then(() => console.log('Inicialização concluída'))
    .catch(error => console.error('Erro na inicialização:', error));
}

module.exports = { initializeLocalStorage, initializeFirstAdmin };