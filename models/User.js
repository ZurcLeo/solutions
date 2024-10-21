const { db } = require('../firebaseAdmin');
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
    const validuser = userId.uid;
    logger.info('getById chamado', { service: 'userModel', function: 'getById', validuser });
    if (!userId) {
      const error = new Error('userId não fornecido');
      logger.error('Erro no getById', { service: 'userModel', function: 'getById', error: error.message });
      throw error;
    }

    try {
      const userDoc = await db.collection('usuario').doc(userId).get();
      logger.info('userDoc: ', userDoc)
      if (!userDoc.exists) {
        const error = new Error('Usuário não encontrado.');
        logger.warn('Usuário não encontrado no getById', { service: 'userModel', function: 'getById', userId });
        throw error;
      }
      const userData = userDoc.data();
      userData.id = userId;
      logger.info('Dados do usuário encontrados', { service: 'userModel', function: 'getById', userData });
      return new User(userData);
    } catch (error) {
      logger.error('Erro ao obter usuário por ID', { service: 'userModel', function: 'getById', userId, error: error.message });
      throw new Error('Erro ao obter usuário por ID');
    }
  }

  static async create(data) {
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
    if (!data.dataCriacao) {
        delete data.dataCriacao; // Remove dataCriacao se for null ou undefined
    }
    
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

static async uploadProfilePicture(userId, file) {
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
    logger.info('delete chamado', { service: 'userModel', function: 'delete', userId: id });
    const userRef = db.collection('usuario').doc(id);
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