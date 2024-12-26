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