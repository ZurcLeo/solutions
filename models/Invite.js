// src/models/Invite.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

/**
 * Modelo para gerenciamento de convites
 * Implementa a lógica de acesso ao banco de dados para a coleção de convites
 */
class Invite {
  /**
   * Construtor do modelo de convite
   * @param {Object} data - Dados para inicializar o convite
   */
  constructor(data) {
    this.id = data.id || null;
    this.inviteId = data.inviteId; // ID único do convite (UUID)
    this.email = data.email; // Email para o qual o convite foi enviado
    this.friendName = data.friendName; // Nome do amigo convidado
    this.senderId = data.senderId; // ID do usuário que enviou o convite
    this.senderName = data.senderName; // Nome do usuário que enviou o convite
    this.senderPhotoURL = data.senderPhotoURL || ''; // URL da foto do remetente
    this.status = data.status || 'pending'; // pending, validated, used, canceled
    this.createdAt = data.createdAt || new Date();
    this.expiresAt = data.expiresAt || null;
    this.lastSentAt = data.lastSentAt || null; // Última vez que o convite foi enviado/reenviado
    this.validatedAt = data.validatedAt || null; // Quando o convite foi validado
    this.validatedBy = data.validatedBy || null; // ID do usuário que validou
    this.usedAt = data.usedAt || null; // Quando o convite foi utilizado
    this.usedBy = data.usedBy || null; // ID do usuário que utilizou
    this.canceledAt = data.canceledAt || null; // Quando o convite foi cancelado
    this.canceledBy = data.canceledBy || null; // ID do usuário que cancelou
    this.resendCount = data.resendCount || 0; // Número de vezes que o convite foi reenviado
  }

  /**
   * Converte a instância para um objeto simples
   * @returns {Object} Objeto representando o convite
   */
  toPlainObject() {
    return {
      id: this.id,
      inviteId: this.inviteId,
      email: this.email,
      friendName: this.friendName,
      senderId: this.senderId,
      senderName: this.senderName,
      senderPhotoURL: this.senderPhotoURL,
      status: this.status,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      lastSentAt: this.lastSentAt,
      validatedAt: this.validatedAt,
      validatedBy: this.validatedBy,
      usedAt: this.usedAt,
      usedBy: this.usedBy,
      canceledAt: this.canceledAt,
      canceledBy: this.canceledBy,
      resendCount: this.resendCount
    };
  }

  /**
   * Busca um convite pelo seu ID único
   * @param {string} inviteId - ID único do convite
   * @returns {Promise<Object>} Objeto contendo o convite e sua referência
   * @throws {Error} Se o convite não for encontrado
   */
  static async getById(inviteId) {
    logger.info(`Buscando convite com ID ${inviteId}`, {
      service: 'inviteModel',
      function: 'getById',
      inviteId,
      email,
      nome
    });
  
    try {
      const db = getFirestore();
      // Consulta filtrando pelo inviteId (não o id do documento)
      const snapshot = await db.collection('convites')
        .where('inviteId', '==', inviteId)
        .get();
      
      if (snapshot.empty) {
        logger.warn(`Convite com ID ${inviteId} não encontrado`, {
          service: 'inviteModel',
          function: 'getById',
          inviteId
        });
        throw new Error('Convite não encontrado.');
      }
  
      // Extração do primeiro documento correspondente
      const inviteDoc = snapshot.docs[0];
      const invite = new Invite({ 
        ...inviteDoc.data(), 
        id: inviteDoc.id 
      });

      logger.info(`Convite com ID ${inviteId} encontrado`, {
        service: 'inviteModel',
        function: 'getById',
        inviteId
      });
  
      return { invite, inviteRef: inviteDoc.ref };
    } catch (error) {
      logger.error(`Erro ao buscar convite com ID ${inviteId}`, {
        service: 'inviteModel',
        function: 'getById',
        inviteId,
        email,
        nome,
        error: error.message
      });

      throw error;
    }
  }  

  /**
   * Cria um novo convite no banco de dados
   * @param {Object} data - Dados do convite a ser criado
   * @returns {Promise<Invite>} O convite criado
   */
  static async create(data) {
    logger.info('Criando novo convite', {
      service: 'inviteModel',
      function: 'create',
      data: { ...data, email: data.email ? data.email.toLowerCase() : null }
    });

    try {
      const db = getFirestore();
      const invite = new Invite({
        ...data,
        email: data.email ? data.email.toLowerCase() : null,
        createdAt: new Date()
      });

      const docRef = await db.collection('convites').add(invite.toPlainObject());
      invite.id = docRef.id;

      logger.info('Convite criado com sucesso', {
        service: 'inviteModel',
        function: 'create',
        inviteId: invite.inviteId,
        id: invite.id
      });

      return invite;
    } catch (error) {
      logger.error('Erro ao criar convite', {
        service: 'inviteModel',
        function: 'create',
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Atualiza um convite existente
   * @param {string} id - ID do documento do convite
   * @param {Object} data - Dados a serem atualizados
   * @returns {Promise<Invite>} O convite atualizado
   * @throws {Error} Se o convite não for encontrado
   */
  static async update(id, data) {
    logger.info(`Atualizando convite com ID ${id}`, {
      service: 'inviteModel',
      function: 'update',
      id,
      data
    });

    try {
      const db = getFirestore();
      const inviteRef = db.collection('convites').doc(id);
      const inviteDoc = await inviteRef.get();

      if (!inviteDoc.exists) {
        throw new Error('Convite não encontrado.');
      }

      // Não permitir atualização do inviteId e senderId para manter integridade
      const { inviteId, senderId, createdAt, ...updateData } = data;

      await inviteRef.update({
        ...updateData,
        updatedAt: new Date()
      });

      const updatedDoc = await inviteRef.get();
      const updatedInvite = new Invite({ 
        ...updatedDoc.data(), 
        id: updatedDoc.id 
      });

      logger.info(`Convite com ID ${id} atualizado com sucesso`, {
        service: 'inviteModel',
        function: 'update',
        id
      });

      return updatedInvite;
    } catch (error) {
      logger.error(`Erro ao atualizar convite com ID ${id}`, {
        service: 'inviteModel',
        function: 'update',
        id,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Remove um convite do banco de dados
   * @param {string} id - ID do documento do convite
   * @returns {Promise<void>}
   * @throws {Error} Se ocorrer um erro durante a exclusão
   */
  static async delete(id) {
    logger.info(`Excluindo convite com ID ${id}`, {
      service: 'inviteModel',
      function: 'delete',
      id
    });

    try {
      const db = getFirestore();
      const inviteRef = db.collection('convites').doc(id);
      await inviteRef.delete();

      logger.info(`Convite com ID ${id} excluído com sucesso`, {
        service: 'inviteModel',
        function: 'delete',
        id
      });
    } catch (error) {
      logger.error(`Erro ao excluir convite com ID ${id}`, {
        service: 'inviteModel',
        function: 'delete',
        id,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Busca convites enviados por um determinado usuário
   * @param {string} userId - ID do usuário remetente
   * @returns {Promise<Array<Invite>>} Lista de convites enviados
   */
  static async getBySenderId(userId) {
    logger.info(`Iniciando a busca por convites do usuário com senderId ${userId}`, {
      service: 'inviteService',
      function: 'getBySenderId',
      userId
    });

    try {
      const db = getFirestore();
      const snapshot = await db.collection('convites')
        .where('senderId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      // Retornar array vazio se não houver convites, em vez de lançar erro
      if (snapshot.empty) {
        logger.info(`Nenhum convite encontrado para o usuário ${userId}`, {
          service: 'inviteModel',
          function: 'getBySenderId',
          userId
        });
        return [];
      }

      const invites = snapshot.docs.map(doc => 
        new Invite({ ...doc.data(), id: doc.id })
      );

      logger.info(`${invites.length} convites encontrados para o usuário ${userId}`, {
        service: 'inviteModel',
        function: 'getBySenderId',
        userId,
        count: invites.length
      });

      return invites;
    } catch (error) {
      logger.error(`Erro ao buscar convites do usuário ${userId}`, {
        service: 'inviteModel',
        function: 'getBySenderId',
        userId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Busca convites pendentes enviados por um usuário
   * @param {string} userId - ID do usuário remetente
   * @returns {Promise<Array<Invite>>} Lista de convites pendentes
   */
  static async getPendingBySender(userId) {
    logger.info(`Buscando convites pendentes enviados pelo usuário ${userId}`, {
      service: 'inviteModel',
      function: 'getPendingBySender',
      userId
    });

    try {
      const db = getFirestore();
      const snapshot = await db.collection('convites')
        .where('senderId', '==', userId)
        .where('status', '==', 'pending')
        .get();

      if (snapshot.empty) {
        return [];
      }

      const invites = snapshot.docs.map(doc => 
        new Invite({ ...doc.data(), id: doc.id })
      );

      logger.info(`${invites.length} convites pendentes encontrados para o usuário ${userId}`, {
        service: 'inviteModel',
        function: 'getPendingBySender',
        userId,
        count: invites.length
      });

      return invites;
    } catch (error) {
      logger.error(`Erro ao buscar convites pendentes do usuário ${userId}`, {
        service: 'inviteModel',
        function: 'getPendingBySender',
        userId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Busca um convite pelo email do destinatário
   * @param {string} email - Email para o qual o convite foi enviado
   * @returns {Promise<Invite|null>} O convite encontrado ou null
   */
  static async findByEmail(email) {
    logger.info(`Buscando convite para o email ${email}`, {
      service: 'inviteModel',
      function: 'findByEmail',
      email
    });

    try {
      const db = getFirestore();
      const snapshot = await db.collection('convites')
        .where('email', '==', email.toLowerCase())
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.info(`Nenhum convite encontrado para o email ${email}`, {
          service: 'inviteModel',
          function: 'findByEmail',
          email
        });
        return null;
      }

      const inviteDoc = snapshot.docs[0];
      const invite = new Invite({ 
        ...inviteDoc.data(), 
        id: inviteDoc.id 
      });

      logger.info(`Convite encontrado para o email ${email}`, {
        service: 'inviteModel',
        function: 'findByEmail',
        email,
        inviteId: invite.inviteId
      });

      return invite;
    } catch (error) {
      logger.error(`Erro ao buscar convite para o email ${email}`, {
        service: 'inviteModel',
        function: 'findByEmail',
        email,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Busca todos os convites com status "pending" que estão expirados
   * @param {number} expirationDays - Número de dias após o qual um convite é considerado expirado
   * @returns {Promise<Array<Invite>>} Lista de convites expirados
   */
  static async getExpiredInvites(expirationDays = 30) {
    logger.info(`Buscando convites expirados (${expirationDays} dias)`, {
      service: 'inviteModel',
      function: 'getExpiredInvites',
      expirationDays
    });

    try {
      const db = getFirestore();
      
      // Calcular data limite para expiração
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() - expirationDays);
      
      const snapshot = await db.collection('convites')
        .where('status', '==', 'pending')
        .where('createdAt', '<=', expirationDate)
        .get();

      const invites = snapshot.docs.map(doc => 
        new Invite({ ...doc.data(), id: doc.id })
      );

      logger.info(`${invites.length} convites expirados encontrados`, {
        service: 'inviteModel',
        function: 'getExpiredInvites',
        count: invites.length
      });

      return invites;
    } catch (error) {
      logger.error(`Erro ao buscar convites expirados`, {
        service: 'inviteModel',
        function: 'getExpiredInvites',
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Marca convites expirados como "canceled"
   * @param {number} expirationDays - Número de dias após o qual um convite é considerado expirado
   * @returns {Promise<number>} Número de convites cancelados
   */
  static async cancelExpiredInvites(expirationDays = 30) {
    logger.info(`Cancelando convites expirados (${expirationDays} dias)`, {
      service: 'inviteModel',
      function: 'cancelExpiredInvites',
      expirationDays
    });

    try {
      const expiredInvites = await this.getExpiredInvites(expirationDays);
      
      if (expiredInvites.length === 0) {
        return 0;
      }
      
      const db = getFirestore();
      const batch = db.batch();
      
      // Preparar lote de atualizações
      expiredInvites.forEach(invite => {
        const inviteRef = db.collection('convites').doc(invite.id);
        batch.update(inviteRef, {
          status: 'canceled',
          canceledAt: new Date(),
          canceledBy: 'system',
          cancellationReason: 'expired'
        });
      });
      
      // Executar atualizações em lote
      await batch.commit();
      
      logger.info(`${expiredInvites.length} convites expirados cancelados com sucesso`, {
        service: 'inviteModel',
        function: 'cancelExpiredInvites',
        count: expiredInvites.length
      });
      
      return expiredInvites.length;
    } catch (error) {
      logger.error(`Erro ao cancelar convites expirados`, {
        service: 'inviteModel',
        function: 'cancelExpiredInvites',
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Obtém estatísticas sobre os convites
   * @returns {Promise<Object>} Estatísticas dos convites
   */
  static async getStatistics() {
    logger.info('Obtendo estatísticas de convites', {
      service: 'inviteModel',
      function: 'getStatistics'
    });

    try {
      const db = getFirestore();
      
      // Obter contadores para cada status
      const pendingSnapshot = await db.collection('convites')
        .where('status', '==', 'pending')
        .count()
        .get();
      
      const usedSnapshot = await db.collection('convites')
        .where('status', '==', 'used')
        .count()
        .get();
      
      const canceledSnapshot = await db.collection('convites')
        .where('status', '==', 'canceled')
        .count()
        .get();
      
      const validatedSnapshot = await db.collection('convites')
        .where('status', '==', 'validated')
        .count()
        .get();
      
      // Calcular taxas de conversão
      const pendingCount = pendingSnapshot.data().count;
      const usedCount = usedSnapshot.data().count;
      const canceledCount = canceledSnapshot.data().count;
      const validatedCount = validatedSnapshot.data().count;
      const totalCount = pendingCount + usedCount + canceledCount + validatedCount;
      
      const conversionRate = totalCount > 0 
        ? (usedCount / totalCount * 100).toFixed(2) 
        : 0;
      
      const stats = {
        total: totalCount,
        pending: pendingCount,
        used: usedCount,
        canceled: canceledCount,
        validated: validatedCount,
        conversionRate: `${conversionRate}%`
      };
      
      logger.info('Estatísticas de convites obtidas com sucesso', {
        service: 'inviteModel',
        function: 'getStatistics',
        stats
      });
      
      return stats;
    } catch (error) {
      logger.error('Erro ao obter estatísticas de convites', {
        service: 'inviteModel',
        function: 'getStatistics',
        error: error.message
      });

      throw error;
    }
  }
}

module.exports = Invite;