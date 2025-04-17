const { getAuth } = require('../firebaseAdmin');
const FirestoreService = require('../utils/firestoreService');
const dbServiceUser = FirestoreService.collection('usuario');
const {getFirestore} = require('../firebaseAdmin')
const { logger } = require('../logger');

const db = getFirestore();

class User {
  constructor(data) {
    this.id = data.uid;
    this.uid = data.uid;
    this.nome = data.nome;
    this.email = data.email;
    this.telefone = data.telefone;
    this.reacoes = data.reacoes || {};
    this.emailVerified = data.emailVerified || false;
    this.perfilPublico = data.perfilPublico || false;
    this.ja3Hash = data.ja3Hash;
    this.caixinhas = data.caixinhas || [];
    this.tipoDeConta = data.tipoDeConta;
    this.isOwnerOrAdmin = data.isOwnerOrAdmin || false;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.descricao = data.descricao;
    this.interesses = data.interesses || {
      lazer: [],
      bemestar: [],
      social: [],
      tecnologia: [],
      negocios: [],
      marketing: [],
      educacao: [],
      marketplace: [],
      sustentabilidade: []
    };
    this.roles = data.roles || {};
    this.amigosAutorizados = data.amigosAutorizados || [];
    this.amigos = data.amigos || [];
    this.dataCriacao = data.dataCriacao || new Date();
    this.saldoElosCoins = data.saldoElosCoins || 0;
    this.conversas = data.conversas || {};
  }

  toPlainObject() {
    return {
      id: this.uid,
      uid: this.uid,
      nome: this.nome,
      email: this.email,
      reacoes: this.reacoes,
      telefone: this.telefone,
      perfilPublico: this.perfilPublico,
      emailVerified: this.emailVerified,
      ja3Hash: this.ja3Hash,
      caixinhas: this.caixinhas,
      tipoDeConta: this.tipoDeConta,
      isOwnerOrAdmin: this.isOwnerOrAdmin,
      fotoDoPerfil: this.fotoDoPerfil,
      descricao: this.descricao,
      interesses: this.interesses,
      roles: this.roles,
      amigosAutorizados: this.amigosAutorizados,
      amigos: this.amigos,
      dataCriacao: this.dataCriacao,
      saldoElosCoins: this.saldoElosCoins,
      conversas: this.conversas
    };
  }

// Adicionando ao modelo User.js existente
static _searchCache = new Map();
static _searchCacheTimeout = 60000; // 1 minuto

static async searchUsers(searchQuery, currentUserId) {
  // Verificar cache
  const cacheKey = `${searchQuery}_${currentUserId}`;
  const cached = this._searchCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < this._searchCacheTimeout)) {
    logger.info('Resultados retornados do cache', { 
      service: 'userModel', 
      function: 'searchUsers', 
      query: searchQuery,
      cacheHit: true
    });
    return cached.results;
  }
  
  try {
    // Buscar todos os usuários (limitando para melhorar performance)
    const usersCollection = await dbServiceUser.limit(100).get();
    
    // Filtragem em memória dos resultados
    const users = usersCollection.docs
      .map(doc => {
        const userData = doc.data();
        userData.id = doc.id;
        return userData;
      })
      .filter(user => {
        // Excluir o usuário atual da busca
        if (user.id === currentUserId || user.uid === currentUserId) {
          return false;
        }
        
        // Critérios de busca: nome ou email contém a query
        const searchLower = searchQuery.toLowerCase();
        const nameMatch = user.nome && user.nome.toLowerCase().includes(searchLower);
        const emailMatch = user.email && user.email.toLowerCase().includes(searchLower);
        const descriptionMatch = user.descricao && user.descricao.toLowerCase().includes(searchLower);
        
        return nameMatch || emailMatch || descriptionMatch;
      })
      .map(userData => new User(userData));

    // Armazenar no cache
    this._searchCache.set(cacheKey, {
      results: users,
      timestamp: Date.now()
    });
    
    // Limitar tamanho do cache para evitar problemas de memória
    if (this._searchCache.size > 100) {
      // Remove a entrada mais antiga
      const oldestKey = [...this._searchCache.keys()][0];
      this._searchCache.delete(oldestKey);
    }

    logger.info('Busca de usuários concluída', { 
      service: 'userModel', 
      function: 'searchUsers', 
      count: users.length,
      query: searchQuery,
      cacheHit: false
    });
    
    return users;
  } catch (error) {
    logger.error('Erro ao buscar usuários', { 
      service: 'userModel', 
      function: 'searchUsers', 
      error: error.message 
    });
    throw new Error(`Erro ao buscar usuários: ${error.message}`);
  }
}

// Método para limpar o cache quando necessário
static clearSearchCache() {
  this._searchCache.clear();
  logger.info('Cache de busca limpo', { 
    service: 'userModel', 
    function: 'clearSearchCache'
  });
}

  static async findAll() {
    // const db = getFirestore();
    try {
      const usersCollection = await dbServiceUser.get();
      
      const users = usersCollection.docs.map(doc => {
        const userData = doc.data();
        userData.id = doc.id;
        return new User(userData);
      });

      logger.info('Usuários obtidos com sucesso', { service: 'userModel', function: 'findAll', count: users.length });
      return users;
    } catch (error) {
      logger.error('Erro ao buscar todos os usuários', { service: 'userModel', function: 'findAll', error: error.message });
      throw new Error('Erro ao buscar todos os usuários');
    }
  }

  static async getById(userId) {
    if (!userId) {
      const error = new Error('userId não fornecido');
      logger.error('Erro no getById', { service: 'userModel', function: 'getById', error: error.message });
      throw error;
    }
  
    try {
      const userDoc = await dbServiceUser.doc(userId).get();
      
      if (!userDoc.exists) {
        // Em vez de lançar erro, registramos que o usuário não foi encontrado
        logger.warn('Usuário não encontrado no getById', { 
          service: 'userModel', 
          function: 'getById', 
          userId 
        });
        
        // Verificamos se temos informações básicas do usuário do Firebase
        try {
          const auth = getAuth();
          const userRecord = await auth.getUser(userId);
          
          // Criar um objeto User com dados básicos do Firebase
          logger.info('Criando objeto User temporário com dados do Firebase', {
            service: 'userModel',
            function: 'getById',
            userId
          });
          
          // Retornar um objeto User básico
          return new User({
            // id: userId,
            uid: userId,
            email: userRecord.email || 'sem email',
            nome: userRecord.displayName || userRecord.email?.split('@')[0] || 'Novo Usuário',
            fotoDoPerfil: userRecord.photoURL || '',
            dataCriacao: new Date(),
            telefone: '',
            ja3Hash: userRecord.ja3Hash || '',
            emailVerified: userRecord.emailVerified || false,
            perfilPublico: false,
            isFirstAccess: true, // Marcar explicitamente como primeiro acesso
            tipoDeConta: 'Cliente',
            saldoElosCoins: 0,
            isOwnerOrAdmin: false,
            roles: {},
            reacoes: {},
            descricao: 'Escreva algo sobre voce.',
            interesses: {},
            conversas: {},
            amigos: [],
            amigosAutorizados: []
          });
        } catch (firebaseError) {
          // Se não conseguirmos obter informação do Firebase, aí sim lançamos erro
          logger.error('Falha ao recuperar dados básicos do Firebase', {
            service: 'userModel',
            function: 'getById',
            userId,
            error: firebaseError.message
          });
          
          throw new Error('Usuário não encontrado.');
        }
      }
      
      // Fluxo normal - usuário encontrado no banco de dados
      const userData = userDoc.data();
      userData.id = userId;
      return new User(userData);
    } catch (error) {
      // Captura erros não tratados
      logger.error('Erro ao obter usuário por ID', { 
        service: 'userModel', 
        function: 'getById', 
        userId, 
        error: error.message 
      });
      throw error;
    }
  }

/**
 * Adiciona uma role ao usuário
 * @param {string} userId - ID do usuário
 * @param {string} roleId - ID da role
 * @param {Object} context - Contexto da role
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Object>} Dados da role adicionada
 */
static async addRole(userId, roleId, context = {}, options = {}) {
  try {
    // Obter referência do documento do usuário
    const userRef = db.collection('usuario').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado');
    }
    
    // Obter definição da role do mapa fixo
    const { roles } = require('../config/data/initialData');
    const roleData = roles[roleId];
    
    if (!roleData) {
      throw new Error(`Role ${roleId} não encontrada`);
    }
    
    // Dados a serem salvos
    const userRole = {
      ...roleData,
      context: context || { type: 'global', resourceId: null },
      validationStatus: options.validationStatus || 'pending',
      assignedAt: new Date().toISOString(),
      metadata: options.metadata || {}
    };
    
    // Atualizar o documento
    await userRef.update({
      [`roles.${roleId}`]: userRole
    });
    
    logger.info('Role adicionada ao usuário com sucesso', {
      function: 'User.addRole',
      userId,
      roleId
    });
    
    return userRole;
  } catch (error) {
    logger.error('Erro ao adicionar role ao usuário', {
      function: 'User.addRole',
      userId,
      roleId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Remove uma role do usuário
 * @param {string} userId - ID do usuário
 * @param {string} roleId - ID da role
 * @returns {Promise<boolean>} Sucesso da operação
 */
static async removeRole(userId, roleId) {
  try {
    const userRef = db.collection('usuario').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado');
    }
    
    const userData = userDoc.data();
    const userRoles = userData.roles || {};
    
    if (!userRoles[roleId]) {
      return false; // Role não existente
    }
    
    // Remover a role
    await userRef.update({
      [`roles.${roleId}`]: firebase.db.FieldValue.delete()
    });
    
    logger.info('Role removida do usuário com sucesso', {
      function: 'User.removeRole',
      userId,
      roleId
    });
    
    return true;
  } catch (error) {
    logger.error('Erro ao remover role do usuário', {
      function: 'User.removeRole',
      userId,
      roleId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Verifica se um usuário tem uma role específica
 * @param {string} userId - ID do usuário
 * @param {string} roleName - Nome da role
 * @param {string} contextType - Tipo de contexto
 * @param {string} resourceId - ID do recurso
 * @returns {Promise<boolean>} Se o usuário tem a role
 */
static async hasRole(userId, roleName, contextType = 'global', resourceId = null) {
  try {
    const userDoc = await db.collection('usuario').doc(userId).get();
    
    if (!userDoc.exists) {
      return false;
    }
    
    const userData = userDoc.data();
    const userRoles = userData.roles || {};
    
    // Buscar a role pelo nome
    const { roles } = require('../config/data/initialData');
    const targetRoleId = Object.keys(roles).find(id => 
      roles[id].name.toLowerCase() === roleName.toLowerCase()
    );
    
    if (!targetRoleId) {
      return false; // Role não definida no sistema
    }
    
    // Verificar se o usuário tem a role
    const userRole = userRoles[targetRoleId];
    
    if (!userRole) {
      return false;
    }
    
    // Verificar status de validação
    if (userRole.validationStatus !== 'validated') {
      return false;
    }
    
    // Verificar contexto
    if (contextType !== 'global') {
      // Se o contexto não é global, verificar compatibilidade
      if (userRole.context.type !== contextType) {
        return false;
      }
      
      // Se resourceId foi especificado, verificar
      if (resourceId && userRole.context.resourceId !== resourceId) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Erro ao verificar role do usuário', {
      function: 'User.hasRole',
      userId,
      roleName,
      error: error.message
    });
    return false; // Em caso de erro, retornar false por segurança
  }
}

/**
 * Verifica se um usuário tem uma permissão específica
 * @param {string} userId - ID do usuário
 * @param {string} permissionName - Nome da permissão
 * @param {string} contextType - Tipo de contexto
 * @param {string} resourceId - ID do recurso
 * @returns {Promise<boolean>} Se o usuário tem a permissão
 */
static async hasPermission(userId, permissionName, contextType = 'global', resourceId = null) {
  try {
    const userDoc = await db.collection('usuario').doc(userId).get();
    
    if (!userDoc.exists) {
      return false;
    }
    
    const userData = userDoc.data();
    const userRoles = userData.roles || {};
    
    // Obter mapeamentos de inicialização
    const { rolePermissions } = require('../config/data/initialData');
    
    // Para cada role do usuário
    for (const roleId in userRoles) {
      const userRole = userRoles[roleId];
      
      // Verificar status de validação
      if (userRole.validationStatus !== 'validated') {
        continue;
      }
      
      // Verificar contexto
      if (contextType !== 'global') {
        // Se o contexto não é global, verificar compatibilidade
        if (userRole.context.type !== contextType) {
          continue;
        }
        
        // Se resourceId foi especificado, verificar
        if (resourceId && userRole.context.resourceId !== resourceId) {
          continue;
        }
      }
      
      // Encontrar permissões para esta role
      const rolePerms = Object.values(rolePermissions)
        .filter(rp => rp.roleId === roleId)
        .map(rp => rp.permissionId);
      
      // Verificar se a permissão está incluída
      const hasPermission = rolePerms.some(permId => {
        const { permissions } = require('../config/data/initialData');
        return permissions[permId]?.name === permissionName;
      });
      
      if (hasPermission) {
        return true;
      }
    }
    
    // Se nenhuma role fornece a permissão
    return false;
  } catch (error) {
    logger.error('Erro ao verificar permissão do usuário', {
      function: 'User.hasPermission',
      userId,
      permissionName,
      error: error.message
    });
    return false; // Em caso de erro, retornar false por segurança
  }
}

  static async searchUsers(query, currentUserId) {
    const db = getFirestore();
    logger.info('searchUsers chamado', { 
      service: 'userModel', 
      function: 'searchUsers', 
      query,
      currentUserId 
    });
  
    if (!query) {
      const error = new Error('Query de busca não fornecida');
      logger.error('Erro no searchUsers', { 
        service: 'userModel', 
        function: 'searchUsers', 
        error: error.message 
      });
      throw error;
    }
  
    try {
      const queryLower = query.toLowerCase();
      logger.info('Realizando busca case-insensitive', { 
        service: 'userModel', 
        function: 'searchUsers', 
        queryLower 
      });
      
      // Primeiro obtemos todos os documentos de usuário
      const mainUserCollection = db.collection('usuario');
      const userDocs = await mainUserCollection.get();
      
      // Array para armazenar as promessas de busca
      const searchPromises = [];
  
      // Para cada documento de usuário, buscamos nos dados
      userDocs.forEach(userDoc => {
        const userDataRef = db.collection('usuario').doc(userDoc.id);
        searchPromises.push(userDataRef.get());
      });
  
      // Aguarda todas as buscas serem concluídas
      const userDataSnapshots = await Promise.all(searchPromises);
  
      // Verificar conexões ativas do usuário atual
      const connectionsRef = db.collection('conexoes').doc(currentUserId).collection('ativas');
      const activeConnections = await connectionsRef.get();
      const activeConnectionIds = new Set(activeConnections.docs.map(doc => doc.id));
  
      // Filtra os resultados baseado na query e nas regras de privacidade
      const users = userDataSnapshots
        .filter(doc => {
          if (!doc.exists) return false;
          const userData = doc.data();
          
          // Verifica se o nome corresponde à busca
          const nameMatches = userData.nome && 
                            userData.nome.toLowerCase().includes(queryLower);
          
          if (!nameMatches) return false;
  
          // Se for o próprio usuário, mostrar
          if (doc.id === currentUserId) return true;
  
          // Se o perfil for público, mostrar
          if (userData.perfilPublico) return true;
  
          // Se for uma conexão ativa, mostrar
          if (activeConnectionIds.has(doc.id)) return true;
  
          // Se não atender nenhuma condição acima, não mostrar
          return false;
        })
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .slice(0, 20);
  
      logger.info('Busca realizada com sucesso', { 
        service: 'userModel', 
        function: 'searchUsers',
        resultsCount: users.length 
      });
  
      return users;
    } catch (error) {
      logger.error('Erro ao buscar usuários', { 
        service: 'userModel', 
        function: 'searchUsers', 
        query,
        error: error.message 
      });
      throw new Error('Erro ao buscar usuários');
    }
  }

  static async create(userData) {
    logger.info('create chamado', { service: 'userModel', function: 'create', userData: userData });
    
    // Garantir que o uid está presente
    if (!userData.uid) {
      logger.error('UID não fornecido na criação do usuário', { service: 'userModel', function: 'create' });
      throw new Error('UID do usuário é obrigatório para criação');
    }
    
    const user = new User(userData);
    try {
      // Usar o UID como ID do documento do Firestore
      await dbServiceUser.doc(userData.uid).set(user.toPlainObject());
      
      // O ID do documento já é o UID, então não precisa atribuir
      logger.info('Usuário criado com sucesso', { service: 'userModel', function: 'create', userId: userData.uid });
      return user;
    } catch (error) {
      logger.error('Erro ao criar usuário', { service: 'userModel', function: 'create', error: error.message });
      throw new Error('Erro ao criar usuário');
    }
  }

  static async update(userId, data) {
    // const db = getFirestore();
    if (!data.dataCriacao) {
        delete data.dataCriacao; // Remove dataCriacao se for null ou undefined
    }
    
    logger.info('update chamado', { service: 'userModel', function: 'update', userId: userId, data });
    const userRef = dbServiceUser.doc(userId);
    try {
      await userRef.update(data);
      const updatedDoc = await userRef.get();
      const updatedUser = new User(updatedDoc.data());
      logger.info('Usuário atualizado com sucesso', { service: 'userModel', function: 'update', userId: userId });
      return updatedUser;
    } catch (error) {
      logger.error('Erro ao atualizar usuário', { service: 'userModel', function: 'update', userId: userId, error: error.message });
      throw new Error('Erro ao atualizar usuário');
    }
  }

static async uploadProfilePicture(userId, file) {
  // const db = getFirestore();
  if (!file || !file.buffer) {
    throw new Error('No file buffer found');
  }

  const fileName = `${userId}/fotoDePerfil.png`;
  const fileRef = storage.bucket().file(fileName);

  try {
    await fileRef.save(file.buffer, {
      contentType: file.mimetype,
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${storage.bucket().name}/${fileName}`;
    await this.update(userId, { fotoDoPerfil: publicUrl });

    logger.info('Foto de perfil atualizada com sucesso', { userId, publicUrl });
    return publicUrl;
  } catch (error) {
    logger.error('Erro ao salvar foto de perfil no storage', { error: error.message });
    throw new Error('Erro ao salvar foto de perfil');
  }
}


  static async delete(id) {
    // const db = getFirestore();

    logger.info('delete chamado', { service: 'userModel', function: 'delete', userId: id });
    const userRef = dbServiceUser.doc(id);
    try {
      await userRef.delete();
      logger.info('Usuário deletado com sucesso', { service: 'userModel', function: 'delete', userId: id });
    } catch (error) {
      logger.error('Erro ao deletar usuário', { service: 'userModel', function: 'delete', userId, error: error.message });
      throw new Error('Erro ao deletar usuário');
    }
  }
}

module.exports = User;