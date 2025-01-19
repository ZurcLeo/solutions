const { getFirestore } = require('../firebaseAdmin'); // Use getFirestore para inicialização lazy
const { logger } = require('../logger');


class User {
  constructor(data) {
    logger.info('Criando nova instância de User', { service: 'userModel', function: 'constructor', data });
    this.id = data.id || data.uid;
    this.uid = data.uid;
    this.nome = data.nome;
    this.email = data.email;
    this.reacoes = data.reacoes || {};
    this.perfilPublico = data.perfilPublico || false;
    this.ja3Hash = data.ja3Hash;
    this.tipoDeConta = data.tipoDeConta;
    this.isOwnerOrAdmin = data.isOwnerOrAdmin || false;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.descricao = data.descricao;
    this.interessesNegocios = data.interessesNegocios || [];
    this.amigosAutorizados = data.amigosAutorizados || [];
    this.amigos = data.amigos || [];
    this.caixinhas = data.caixinhas || [];
    this.interessesPessoais = data.interessesPessoais || [];
    this.dataCriacao = data.dataCriacao ? new Date(data.dataCriacao.seconds * 1000) : new Date();
    this.saldoElosCoins = data.saldoElosCoins || 0;
    this.conversasComMensagensNaoLidas = data.conversasComMensagensNaoLidas || [];
  }

  toPlainObject() {
    return {
      id: this.id,
      uid: this.uid,
      nome: this.nome,
      email: this.email,
      reacoes: this.reacoes,
      perfilPublico: this.perfilPublico,
      ja3Hash: this.ja3Hash,
      tipoDeConta: this.tipoDeConta,
      isOwnerOrAdmin: this.isOwnerOrAdmin,
      fotoDoPerfil: this.fotoDoPerfil,
      descricao: this.descricao,
      interessesNegocios: this.interessesNegocios,
      amigosAutorizados: this.amigosAutorizados,
      amigos: this.amigos,
      caixinhas : this.caixinhas,
      interessesPessoais: this.interessesPessoais,
      dataCriacao: this.dataCriacao,
      saldoElosCoins: this.saldoElosCoins,
      conversasComMensagensNaoLidas: this.conversasComMensagensNaoLidas
    };
  }

  static async getById(userId) {
    const db = getFirestore(); // Use getFirestore para inicializar o Firestore corretamente
    logger.info('getById chamado', { service: 'userModel', function: 'getById', userId });

    if (!userId) {
      const error = new Error('userId não fornecido');
      logger.error('Erro no getById', { service: 'userModel', function: 'getById', error: error.message });
      throw error;
    }

    try {
      const userDoc = await db.collection('usuario').doc(userId).get();
      if (!userDoc.exists) {
        const error = new Error('Usuário não encontrado.');
        logger.warn('Usuário não encontrado no getById', { service: 'userModel', function: 'getById', userId });
        throw error;
      }

      const userData = userDoc.data();
      userData.uid = userId;
      logger.info('Dados do usuário encontrados', { service: 'userModel', function: 'getById', userData });
      return new User(userData);
    } catch (error) {
      logger.error('Erro ao obter usuário por ID', { service: 'userModel', function: 'getById', userId, error: error.message });
      throw new Error('Erro ao obter usuário por ID');
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

  static async create(data) {
    const db = getFirestore(); // Garantir inicialização do Firestore
    logger.info('create chamado', { service: 'userModel', function: 'create', data });
    const user = new User(data);
    try {
      const docRef = await db.collection('usuario').add(user.toPlainObject());
      user.id = docRef.id;
      logger.info('Usuário criado com sucesso', { service: 'userModel', function: 'create', userId: user.id });
      return user;
    } catch (error) {
      logger.error('Erro ao criar usuário', { service: 'userModel', function: 'create', error: error.message });
      throw new Error('Erro ao criar usuário');
    }
  }

  static async update(userId, data) {
    const db = getFirestore(); // Garantir inicialização do Firestore
    logger.info('update chamado', { service: 'userModel', function: 'update', userId: userId, data });

    const userRef = db.collection('usuario').doc(userId);
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

  static async delete(userId) {
    const db = getFirestore(); // Garantir inicialização do Firestore
    logger.info('delete chamado', { service: 'userModel', function: 'delete', userId });
    try {
      await db.collection('usuario').doc(userId).delete();
      logger.info('Usuário deletado com sucesso', { service: 'userModel', function: 'delete', userId });
    } catch (error) {
      logger.error('Erro ao deletar usuário', { service: 'userModel', function: 'delete', userId, error: error.message });
      throw new Error('Erro ao deletar usuário');
    }
  }
}

module.exports = User;