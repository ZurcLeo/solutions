// src/models/Dispute.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const db = getFirestore();
const CAIXINHAS_COLLECTION = 'caixinhas';
const DISPUTES_SUBCOLLECTION = 'disputes';

class Dispute {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.title = data.title;
    this.description = data.description;
    this.type = data.type; // RULE_CHANGE, LOAN_APPROVAL, MEMBER_REMOVAL
    this.proposedBy = data.proposedBy;
    this.proposedByName = data.proposedByName || 'Membro da Caixinha';
    this.proposedChanges = data.proposedChanges || {};
    this.status = data.status || 'OPEN';
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    this.expiresAt = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.resolvedAt = data.resolvedAt ? new Date(data.resolvedAt) : null;
    this.votes = data.votes || [];
  }

  static _getDisputesCollection(caixinhaId) {
    return db.collection(CAIXINHAS_COLLECTION).doc(caixinhaId).collection(DISPUTES_SUBCOLLECTION);
  }

  static async getByCaixinhaId(caixinhaId, status) {
    logger.info('Buscando disputas por caixinhaId', {
      model: 'Dispute',
      method: 'getByCaixinhaId',
      caixinhaId,
      status
    });

    try {
      let query = this._getDisputesCollection(caixinhaId);

      if (status === 'active') {
        query = query.where('status', '==', 'OPEN');
      } else if (status === 'resolved') {
        query = query.where('status', 'in', ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']);
      }

      const snapshot = await query.get();
      const disputes = [];

      snapshot.forEach(doc => {
        disputes.push(new Dispute({ id: doc.id, ...doc.data(), caixinhaId }));
      });

      logger.info('Disputas recuperadas com sucesso', {
        model: 'Dispute',
        method: 'getByCaixinhaId',
        count: disputes.length,
        caixinhaId
      });

      return disputes;
    } catch (error) {
      logger.error('Erro ao buscar disputas', {
        model: 'Dispute',
        method: 'getByCaixinhaId',
        error: error.message,
        stack: error.stack,
        caixinhaId
      });
      throw error;
    }
  }

  static async getById(caixinhaId, disputeId) {
    logger.info('Buscando disputa por ID', {
      model: 'Dispute',
      method: 'getById',
      disputeId,
      caixinhaId
    });

    try {
      const doc = await this._getDisputesCollection(caixinhaId).doc(disputeId).get();

      if (!doc.exists) {
        throw new Error(`Disputa não encontrada com o ID: ${disputeId} na caixinha: ${caixinhaId}`);
      }

      logger.info('Disputa recuperada com sucesso', {
        model: 'Dispute',
        method: 'getById',
        disputeId,
        caixinhaId
      });

      return new Dispute({ id: doc.id, ...doc.data(), caixinhaId });
    } catch (error) {
      logger.error('Erro ao buscar disputa', {
        model: 'Dispute',
        method: 'getById',
        error: error.message,
        stack: error.stack,
        disputeId,
        caixinhaId
      });
      throw error;
    }
  }

  static async create(data) {
    logger.info('Criando nova disputa', {
      model: 'Dispute',
      method: 'create',
      caixinhaId: data.caixinhaId,
      type: data.type,
      data
    });

    try {
      const dispute = new Dispute(data);
      
      // Remover o campo id undefined antes de enviar para Firestore
      const { id, ...disputeData } = dispute;
      
      const docRef = await this._getDisputesCollection(dispute.caixinhaId).add({
        ...disputeData,
        createdAt: dispute.createdAt.toISOString(),
        expiresAt: dispute.expiresAt.toISOString(),
        resolvedAt: dispute.resolvedAt ? dispute.resolvedAt.toISOString() : null
      });

      dispute.id = docRef.id;

      logger.info('Disputa criada com sucesso', {
        model: 'Dispute',
        method: 'create',
        disputeId: dispute.id,
        caixinhaId: dispute.caixinhaId
      });

      return dispute;
    } catch (error) {
      logger.error('Erro ao criar disputa', {
        model: 'Dispute',
        method: 'create',
        error: error.message,
        stack: error.stack,
        caixinhaId: data.caixinhaId
      });
      throw error;
    }
  }

  static async update(caixinhaId, disputeId, data) {
    logger.info('Atualizando disputa', {
      model: 'Dispute',
      method: 'update',
      disputeId,
      caixinhaId
    });

    try {
      const disputeRef = this._getDisputesCollection(caixinhaId).doc(disputeId);

      // Converter datas para string ISO
      if (data.createdAt instanceof Date) data.createdAt = data.createdAt.toISOString();
      if (data.expiresAt instanceof Date) data.expiresAt = data.expiresAt.toISOString();
      if (data.resolvedAt instanceof Date) data.resolvedAt = data.resolvedAt.toISOString();

      await disputeRef.update(data);

      const updatedDoc = await disputeRef.get();
      const updatedDispute = new Dispute({ id: updatedDoc.id, ...updatedDoc.data(), caixinhaId });

      logger.info('Disputa atualizada com sucesso', {
        model: 'Dispute',
        method: 'update',
        disputeId,
        caixinhaId,
        status: updatedDispute.status
      });

      return updatedDispute;
    } catch (error) {
      logger.error('Erro ao atualizar disputa', {
        model: 'Dispute',
        method: 'update',
        error: error.message,
        stack: error.stack,
        disputeId,
        caixinhaId
      });
      throw error;
    }
  }

  static async addVote(caixinhaId, disputeId, voteData) {
    logger.info('Adicionando voto à disputa', {
      model: 'Dispute',
      method: 'addVote',
      disputeId,
      caixinhaId,
      userId: voteData.userId
    });

    try {
      const dispute = await this.getById(caixinhaId, disputeId);

      // Verificar se o usuário já votou
      const existingVoteIndex = dispute.votes.findIndex(vote => vote.userId === voteData.userId);

      if (existingVoteIndex >= 0) {
        // Atualiza o voto existente
        dispute.votes[existingVoteIndex] = {
          ...dispute.votes[existingVoteIndex],
          ...voteData,
          votedAt: new Date().toISOString()
        };
      } else {
        // Adiciona novo voto
        dispute.votes.push({
          ...voteData,
          votedAt: new Date().toISOString()
        });
      }

      // Atualiza a disputa
      return await this.update(caixinhaId, disputeId, { votes: dispute.votes });
    } catch (error) {
      logger.error('Erro ao adicionar voto', {
        model: 'Dispute',
        method: 'addVote',
        error: error.message,
        stack: error.stack,
        disputeId,
        caixinhaId,
        userId: voteData.userId
      });
      throw error;
    }
  }
}

module.exports = Dispute;