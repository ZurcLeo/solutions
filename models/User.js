const { getAuth } = require('../firebaseAdmin');
const FirestoreService = require('../utils/firestoreService');
const dbServiceUser = FirestoreService.collection('usuario');
const { logger } = require('../logger');

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
      tipoDeConta: this.tipoDeConta,
      isOwnerOrAdmin: this.isOwnerOrAdmin,
      fotoDoPerfil: this.fotoDoPerfil,
      descricao: this.descricao,
      interesses: this.interesses,
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
      throw error; // Propagar o erro original em vez de criar um novo
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
      logger.error('Erro ao deletar usuário', { service: 'userModel', function: 'delete', userId: id, error: error.message });
      throw new Error('Erro ao deletar usuário');
    }
  }
}

module.exports = User;