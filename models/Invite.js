const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

class Invite {
  constructor(data) {
    this.id = data.id;
    this.createdAt = data.createdAt ? new Date(data.createdAt._seconds * 1000) : new Date();
    this.senderId = data.senderId;
    this.senderName = data.senderName;
    this.senderPhotoURL = data.senderPhotoURL;
    this.inviteId = data.inviteId;
    this.friendName = data.friendName;
    this.email = data.email;
    this.validatedBy = data.validatedBy || null;
    this.status = data.status;
    this.lastSentAt = data.lastSentAt ? new Date(data.lastSentAt._seconds * 1000) : null;
  }

  static async getById(inviteId, email = null, nome = null) {
    const db = getFirestore(); // Garante a inicialização do Firestore
  
    logger.info(`Iniciando a busca pelo convite com inviteId ${inviteId}`, {
      service: 'inviteService',
      function: 'getById',
      inviteId,
      email,
      nome
    });
  
    try {
      // Construção da consulta com critérios
      let query = db.collection('convites').where('inviteId', '==', inviteId);
  
      if (email) {
        query = query.where('email', '==', email);
      }
  
      if (nome) {
        query = query.where('friendName', '==', nome);
      }
  
      const snapshot = await query.get();
  
      // Verificação de resultados
      if (snapshot.empty) {
        logger.error('Convite não encontrado com os critérios fornecidos.', {
          service: 'inviteService',
          function: 'getById',
          inviteId,
          email,
          nome
        });
        throw new Error('Convite não encontrado.');
      }
  
      // Extração do primeiro documento correspondente
      const inviteDoc = snapshot.docs[0];
      const invite = new Invite({ ...inviteDoc.data(), id: inviteDoc.id });
  
      logger.info(`Convite com inviteId ${inviteId} encontrado com sucesso`, {
        service: 'inviteService',
        function: 'getById',
        inviteId,
        inviteData: invite
      });
  
      return { invite, inviteRef: inviteDoc.ref };
    } catch (error) {
      logger.error(`Erro ao buscar convite com inviteId ${inviteId}`, {
        service: 'inviteService',
        function: 'getById',
        inviteId,
        email,
        nome,
        error: error.message
      });
  
      throw new Error('Erro ao buscar convite.');
    }
  }  

  static async create(data) {
    const db = getFirestore(); // Garante a inicialização do Firestore
    logger.info('Iniciando a criação de um novo convite', {
      service: 'inviteService',
      function: 'create',
      inviteData: data
    });

    try {
      const invite = new Invite(data);
      const docRef = await db.collection('convites').add({ ...invite });
      invite.id = docRef.id;

      logger.info('Convite criado com sucesso', {
        service: 'inviteService',
        function: 'create',
        inviteData: invite
      });

      return invite;
    } catch (error) {
      logger.error('Erro ao criar novo convite', {
        service: 'inviteService',
        function: 'create',
        error: error.message
      });

      throw new Error('Erro ao criar novo convite.');
    }
  }

  static async update(id, data) {
    const db = getFirestore(); // Garante a inicialização do Firestore
    logger.info(`Iniciando a atualização do convite com ID ${id}`, {
      service: 'inviteService',
      function: 'update',
      inviteId: id,
      updateData: data
    });

    try {
      const inviteRef = db.collection('convites').doc(id);
      const inviteDoc = await inviteRef.get();

      if (!inviteDoc.exists) {
        throw new Error('Nenhum convite encontrado com este código.');
      }

      await inviteRef.update(data);

      const updatedInvite = new Invite({ ...inviteDoc.data(), ...data, id: inviteDoc.id });

      logger.info(`Convite com ID ${id} atualizado com sucesso`, {
        service: 'inviteService',
        function: 'update',
        inviteId: id,
        inviteData: updatedInvite
      });

      return updatedInvite;
    } catch (error) {
      logger.error(`Erro ao atualizar convite com ID ${id}`, {
        service: 'inviteService',
        function: 'update',
        inviteId: id,
        error: error.message
      });

      throw new Error('Erro ao atualizar convite.');
    }
  }

  static async delete(id) {
    const db = getFirestore(); // Garante a inicialização do Firestore
    logger.info(`Iniciando a exclusão do convite com ID ${id}`, {
      service: 'inviteService',
      function: 'delete',
      inviteId: id
    });

    try {
      const inviteRef = db.collection('convites').doc(id);
      await inviteRef.delete();

      logger.info(`Convite com ID ${id} excluído com sucesso`, {
        service: 'inviteService',
        function: 'delete',
        inviteId: id
      });
    } catch (error) {
      logger.error(`Erro ao excluir convite com ID ${id}`, {
        service: 'inviteService',
        function: 'delete',
        inviteId: id,
        error: error.message
      });

      throw new Error('Erro ao excluir convite.');
    }
  }

  static async getBySenderId(userId) {
    const db = getFirestore(); // Garante a inicialização do Firestore
    logger.info(`Iniciando a busca por convites do usuário com senderId ${userId}`, {
      service: 'inviteService',
      function: 'getBySenderId',
      userId
    });

    try {
      const snapshot = await db.collection('convites').where('senderId', '==', userId).get();
      logger.warn('::::::::::::::::::::SNAPSHOT:::::::::::[/models/Invite.js]::::::::::', snapshot)
      if (snapshot.empty) {
        throw new Error('Nenhum convite encontrado para este usuário.');
      }

      const invites = snapshot.docs.map(doc => new Invite({ ...doc.data(), id: doc.id }));

      logger.info(`Convites do usuário com senderId ${userId} encontrados com sucesso`, {
        service: 'inviteService',
        function: 'getBySenderId',
        userId,
        invites
      });

      return invites;
    } catch (error) {
      logger.error(`Erro ao buscar convites do usuário com senderId ${userId}`, {
        service: 'inviteService',
        function: 'getBySenderId',
        userId,
        error: error.message
      });

      throw new Error('Erro ao buscar convites do usuário.');
    }
  }
}

module.exports = Invite;