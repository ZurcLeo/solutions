const { getFirestore } = require('../firebaseAdmin');
const db = getFirestore();
const { logger } = require('../logger');

class CaixinhaInvite {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.type = data.type || 'caixinha_invite'; // caixinha_invite ou caixinha_email_invite
    this.status = data.status || 'pending'; // pending, accepted, rejected, canceled, expired
    this.senderId = data.senderId;
    this.senderName = data.senderName;
    this.targetName = data.targetName;
    this.targetId = data.targetId; // Para convites para usuários existentes
    this.email = data.email; // Para convites por email
    this.message = data.message || '';
    this.createdAt = data.createdAt || new Date();
    this.expiresAt = data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias
    this.respondedAt = data.respondedAt;
    this.responseReason = data.responseReason;
  }

  /**
   * Busca um convite específico pelo ID
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} caxinhaInviteId - ID do convite
   * @returns {Promise<CaixinhaInvite>} Objeto CaixinhaInvite
   */
  static async getById(caixinhaId, caxinhaInviteId) {
    const doc = await db.collection('caixinhas').doc(caixinhaId).collection('pendingRequests').doc(caxinhaInviteId).get();
    if (!doc.exists) {
      // Se não encontrar nos pendentes, procurar no histórico
      const historicDoc = await db.collection('caixinhas').doc(caixinhaId).collection('historic').doc(caxinhaInviteId).get();
      if (!historicDoc.exists) {
        throw new Error('Convite não encontrado.');
      }
      return new CaixinhaInvite({ id: historicDoc.id, ...historicDoc.data() });
    }
    return new CaixinhaInvite({ id: doc.id, ...doc.data() });
  }

  /**
   * Cria um novo convite para a caixinha
   * @param {Object} data - Dados do convite
   * @returns {Promise<CaixinhaInvite>} Objeto CaixinhaInvite criado
   */
  static async create(data) {
    // Validar dados mínimos necessários
    if (!data.caixinhaId) {
      throw new Error('ID da caixinha é obrigatório.');
    }
    if (!data.senderId) {
      throw new Error('ID do remetente é obrigatório.');
    }
    if (!data.targetId && !data.email) {
      throw new Error('É necessário fornecer ID do destinatário ou email.');
    }

    const invite = new CaixinhaInvite(data);
    logger.info('Criando novo convite para caixinha:', invite);

    // Iniciar uma operação em lote para garantir consistência
    const batch = db.batch();

    // Gerar um ID único para o convite
    const inviteRef = db.collection('caixinhas').doc(data.caixinhaId).collection('pendingRequests').doc();
    const inviteId = inviteRef.id;
    invite.id = inviteId;

    const inviteData = {
      id: inviteId,
      caixinhaId: invite.caixinhaId,
      type: invite.type,
      status: invite.status,
      senderId: invite.senderId,
      senderName: invite.senderName,
      targetName: invite.targetName,
      targetId: invite.targetId || null,
      email: invite.email || null,
      message: invite.message || null,
      createdAt: invite.createdAt || new Date(),
      expiresAt: invite.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    };

    // 1. Criar o convite na coleção pendingRequests da caixinha
    batch.set(inviteRef, inviteData);

    // 2. Se há um targetId (usuário existe), criar uma referência na coleção de convites do usuário
    if (data.targetId) {
      const userInviteRef = db.collection('usuario')
        .doc(data.targetId)
        .collection('pendingCaixinhaInvites')
        .doc(inviteId);

      batch.set(userInviteRef, {
        ...inviteData,
        originalPath: `caixinhas/${data.caixinhaId}/pendingRequests/${inviteId}`
      });
    }

    // 3. Adicionar à coleção de convites enviados pelo remetente
    const senderInviteRef = db.collection('usuario')
      .doc(data.senderId)
      .collection('sentCaixinhaInvites')
      .doc(inviteId);

    batch.set(senderInviteRef, {
      ...inviteData,
      originalPath: `caixinhas/${data.caixinhaId}/pendingRequests/${inviteId}`
    });

    // Executar o lote de operações
    try {
      await batch.commit();
      logger.info(`Convite ${inviteId} criado com sucesso para a caixinha ${data.caixinhaId}`);
      return invite;
    } catch (error) {
      logger.error(`Erro ao criar convite: ${error.message}`, error);
      throw new Error(`Falha ao criar convite: ${error.message}`);
    }
  }

  /**
   * Atualiza o status de um convite
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} caxinhaInviteId - ID do convite
   * @param {Object} data - Dados a serem atualizados
   * @returns {Promise<CaixinhaInvite>} Objeto CaixinhaInvite atualizado
   */
  static async updateStatus(caixinhaId, caxinhaInviteId, data) {
    // Iniciar uma operação em lote para garantir consistência
    const batch = db.batch();
    
    // Referência ao convite original na caixinha
    const inviteRef = db.collection('caixinhas')
      .doc(caixinhaId)
      .collection('pendingRequests')
      .doc(caxinhaInviteId);
      
    const inviteDoc = await inviteRef.get();
    
    if (!inviteDoc.exists) {
      throw new Error('Convite não encontrado ou já processado.');
    }

    const currentData = inviteDoc.data();
    const updatedData = { ...data };
    
    // Se o status mudou para aceito ou rejeitado, mover para histórico
    if (data.status === 'accepted' || data.status === 'rejected') {
      updatedData.respondedAt = data.respondedAt || new Date();
      
      // Adicionar ao histórico da caixinha
      const historicRef = db.collection('caixinhas')
        .doc(caixinhaId)
        .collection('historic')
        .doc(caxinhaInviteId);
      
      batch.set(historicRef, {
        ...currentData,
        ...updatedData
      });
      
      // Remover dos pendentes da caixinha
      batch.delete(inviteRef);
      
      // Se houver um targetId, atualizar na coleção do usuário também
      if (currentData.targetId) {
        // Remover dos convites pendentes do usuário
        const userPendingRef = db.collection('usuario')
          .doc(currentData.targetId)
          .collection('pendingCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        // Verificar se o documento existe antes de tentar deletar
        const userPendingDoc = await userPendingRef.get();
        if (userPendingDoc.exists) {
          batch.delete(userPendingRef);
        }
        
        // Adicionar ao histórico do usuário
        const userHistoricRef = db.collection('usuario')
          .doc(currentData.targetId)
          .collection('historicCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        batch.set(userHistoricRef, {
          ...currentData,
          ...updatedData,
          originalPath: `caixinhas/${caixinhaId}/historic/${caxinhaInviteId}`
        });
      }
      
      // Atualizar também na coleção do remetente
      if (currentData.senderId) {
        // Remover dos convites enviados pendentes do remetente
        const senderPendingRef = db.collection('usuario')
          .doc(currentData.senderId)
          .collection('sentCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        // Verificar se o documento existe antes de tentar deletar
        const senderPendingDoc = await senderPendingRef.get();
        if (senderPendingDoc.exists) {
          batch.delete(senderPendingRef);
        }
        
        // Adicionar ao histórico de convites enviados do remetente
        const senderHistoricRef = db.collection('usuario')
          .doc(currentData.senderId)
          .collection('historicSentCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        batch.set(senderHistoricRef, {
          ...currentData,
          ...updatedData,
          originalPath: `caixinhas/${caixinhaId}/historic/${caxinhaInviteId}`
        });
      }
    } else {
      // Apenas atualizar o documento existente na caixinha
      batch.update(inviteRef, updatedData);
      
      // Se houver um targetId, atualizar na coleção do usuário também
      if (currentData.targetId) {
        const userInviteRef = db.collection('usuario')
          .doc(currentData.targetId)
          .collection('pendingCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        // Verificar se o documento existe antes de tentar atualizar
        const userDoc = await userInviteRef.get();
        if (userDoc.exists) {
          batch.update(userInviteRef, updatedData);
        }
      }
      
      // Atualizar também na coleção do remetente
      if (currentData.senderId) {
        const senderInviteRef = db.collection('usuario')
          .doc(currentData.senderId)
          .collection('sentCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        // Verificar se o documento existe antes de tentar atualizar
        const senderDoc = await senderInviteRef.get();
        if (senderDoc.exists) {
          batch.update(senderInviteRef, updatedData);
        }
      }
    }
    
    // Executar o lote de operações
    try {
      await batch.commit();
      logger.info(`Status do convite ${caxinhaInviteId} atualizado para ${data.status}`);
      
      // Retornar o objeto atualizado
      if (data.status === 'accepted' || data.status === 'rejected') {
        const historicDoc = await db.collection('caixinhas')
          .doc(caixinhaId)
          .collection('historic')
          .doc(caxinhaInviteId)
          .get();
          
        return new CaixinhaInvite({ id: historicDoc.id, ...historicDoc.data() });
      } else {
        const updatedDoc = await db.collection('caixinhas')
          .doc(caixinhaId)
          .collection('pendingRequests')
          .doc(caxinhaInviteId)
          .get();
          
        return new CaixinhaInvite({ id: updatedDoc.id, ...updatedDoc.data() });
      }
    } catch (error) {
      logger.error(`Erro ao atualizar status do convite: ${error.message}`, error);
      throw new Error(`Falha ao atualizar status do convite: ${error.message}`);
    }
  }

  /**
   * Busca convites recebidos por um usuário diretamente na coleção userInvites
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array<CaixinhaInvite>>} Lista de convites
   */
  static async getReceivedInvites(userId, options = {}) {
    const { status = 'pending', type = null } = options;
    const invites = [];
    
    try {
      // Buscar na estrutura centralizada de userInvites
      let query = db.collection('usuario')
        .doc(userId)
        .collection('pendingCaixinhaInvites');
      
      // Adicionar filtros conforme necessário
      if (type && type !== 'all') {
        query = query.where('type', '==', type);
      }
      
      if (status !== 'all') {
        query = query.where('status', '==', status);
      }
      
      const invitesSnapshot = await query.get();
      
      // Processar resultados
      invitesSnapshot.forEach(doc => {
        invites.push(new CaixinhaInvite({ id: doc.id, ...doc.data() }));
      });
      
      logger.info(`Encontrados ${invites.length} convites recebidos para o usuário ${userId}`);
      return invites;
      
    } catch (error) {
      logger.error(`Erro ao buscar convites recebidos: ${error.message}`, error);
      return [];
    }
  }

  /**
   * Busca convites enviados por um usuário diretamente na coleção userInvites
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array<CaixinhaInvite>>} Lista de convites
   */
  static async getSentInvites(userId, options = {}) {
    const { status = 'pending', type = null } = options;
    const invites = [];
    
    try {
      // Buscar na estrutura centralizada de userInvites
      let query = db.collection('usuario')
        .doc(userId)
        .collection('sentCaixinhaInvites');
      
      // Adicionar filtros conforme necessário
      if (type && type !== 'all') {
        query = query.where('type', '==', type);
      }
      
      if (status !== 'all') {
        query = query.where('status', '==', status);
      }
      
      const invitesSnapshot = await query.get();
      
      // Processar resultados
      invitesSnapshot.forEach(doc => {
        invites.push(new CaixinhaInvite({ id: doc.id, ...doc.data() }));
      });
      
      logger.info(`Encontrados ${invites.length} convites enviados pelo usuário ${userId}`);
      return invites;
      
    } catch (error) {
      logger.error(`Erro ao buscar convites enviados: ${error.message}`, error);
      return [];
    }
  }

  /**
   * Busca convites por caixinha
   * @param {string} caixinhaId - ID da caixinha
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array<CaixinhaInvite>>} Lista de convites
   */
  static async getByCaixinhaId(caixinhaId, options = {}) {
    const { status = 'pending' } = options;
    
    try {
      let query = db.collection('caixinhas').doc(caixinhaId).collection('pendingRequests');
      
      // Filtrar por status, se for diferente de 'all'
      if (status !== 'all') {
        query = query.where('status', '==', status);
      }
      
      const invitesSnapshot = await query.get();
      const invites = [];
      
      invitesSnapshot.forEach(doc => {
        invites.push(new CaixinhaInvite({ id: doc.id, ...doc.data() }));
      });

      logger.info(`Encontrados ${invites.length} convites para a caixinha ${caixinhaId}`);
      return invites;
    } catch (error) {
      logger.error(`Erro ao buscar convites da caixinha: ${error.message}`, error);
      return [];
    }
  }
  
  /**
   * Exclui um convite pendente
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} caxinhaInviteId - ID do convite
   * @returns {Promise<void>}
   */
  static async delete(caixinhaId, caxinhaInviteId) {
    // Iniciar uma operação em lote para garantir consistência
    const batch = db.batch();
    
    try {
      // Referência ao convite original
      const inviteRef = db.collection('caixinhas')
        .doc(caixinhaId)
        .collection('pendingRequests')
        .doc(caxinhaInviteId);
      
      const inviteDoc = await inviteRef.get();
      
      if (!inviteDoc.exists) {
        throw new Error('Convite não encontrado ou já processado.');
      }
      
      const inviteData = inviteDoc.data();
      
      // Excluir o convite da caixinha
      batch.delete(inviteRef);
      
      // Se houver um targetId, excluir da coleção do usuário
      if (inviteData.targetId) {
        const userInviteRef = db.collection('usuario')
          .doc(inviteData.targetId)
          .collection('pendingCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        const userDoc = await userInviteRef.get();
        if (userDoc.exists) {
          batch.delete(userInviteRef);
        }
      }
      
      // Excluir da coleção do remetente
      if (inviteData.senderId) {
        const senderInviteRef = db.collection('usuario')
          .doc(inviteData.senderId)
          .collection('sentCaixinhaInvites')
          .doc(caxinhaInviteId);
        
        const senderDoc = await senderInviteRef.get();
        if (senderDoc.exists) {
          batch.delete(senderInviteRef);
        }
      }
      
      // Executar o lote de operações
      await batch.commit();
      
      logger.info(`Convite ${caxinhaInviteId} excluído com sucesso da caixinha ${caixinhaId}`);
    } catch (error) {
      logger.error(`Erro ao excluir convite: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Reenvia um convite existente
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} caxinhaInviteId - ID do convite
   * @param {Object} options - Opções adicionais (ex: nova mensagem)
   * @returns {Promise<CaixinhaInvite>} Convite atualizado
   */
  static async resendInvite(caixinhaId, caxinhaInviteId, options = {}) {
    try {
      // Buscar o convite original
      const invite = await this.getById(caixinhaId, caxinhaInviteId);
      
      if (!invite) {
        throw new Error('Convite não encontrado.');
      }
      
      // Atualizar a data de expiração e mensagem (se fornecida)
      const updateData = {
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Nova expiração de 7 dias
      };
      
      if (options.message) {
        updateData.message = options.message;
      }
      
      // Atualizar o status para 'pending' se estiver expirado
      if (invite.status === 'expired') {
        updateData.status = 'pending';
      }
      
      // Atualizar o convite
      const updatedInvite = await this.updateStatus(caixinhaId, caxinhaInviteId, updateData);
      
      logger.info(`Convite ${caxinhaInviteId} reenviado com sucesso`);
      return updatedInvite;
      
    } catch (error) {
      logger.error(`Erro ao reenviar convite: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Verifica e marca convites expirados
   * @returns {Promise<number>} Número de convites atualizados
   */
  static async checkExpiredInvites() {
    const now = new Date();
    let updatedCount = 0;
    
    try {
      // Buscar todas as caixinhas
      const caixinhasSnapshot = await db.collection('caixinhas').get();
      
      for (const caixinhaDoc of caixinhasSnapshot.docs) {
        const caixinhaId = caixinhaDoc.id;
        
        // Buscar convites pendentes expirados
        const expiredInvitesSnapshot = await db.collection('caixinhas')
          .doc(caixinhaId)
          .collection('pendingRequests')
          .where('status', '==', 'pending')
          .where('expiresAt', '<', now)
          .get();
        
        // Atualizar status para expirado
        const batch = db.batch();
        let batchCount = 0;
        
        for (const doc of expiredInvitesSnapshot.docs) {
          const inviteId = doc.id;
          const inviteData = doc.data();
          
          // Atualizar na coleção da caixinha
          const inviteRef = db.collection('caixinhas')
            .doc(caixinhaId)
            .collection('pendingRequests')
            .doc(inviteId);
            
          batch.update(inviteRef, { status: 'expired' });
          
          // Atualizar no userInvites do destinatário
          if (inviteData.targetId) {
            const userInviteRef = db.collection('usuario')
              .doc(inviteData.targetId)
              .collection('pendingCaixinhaInvites')
              .doc(inviteId);
            
            batch.update(userInviteRef, { status: 'expired' });
          }
          
          // Atualizar no userInvites do remetente
          if (inviteData.senderId) {
            const senderInviteRef = db.collection('usuario')
              .doc(inviteData.senderId)
              .collection('sentCaixinhaInvites')
              .doc(inviteId);
            
            batch.update(senderInviteRef, { status: 'expired' });
          }
          
          batchCount++;
          updatedCount++;
          
          // Commitar o batch a cada 500 documentos para evitar limites do Firestore
          if (batchCount >= 500) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        
        // Commitar o batch final se ainda houver documentos
        if (batchCount > 0) {
          await batch.commit();
        }
      }
      
      logger.info(`${updatedCount} convites marcados como expirados`);
      return updatedCount;
      
    } catch (error) {
      logger.error(`Erro ao verificar convites expirados: ${error.message}`, error);
      throw error;
    }
  }
}

module.exports = CaixinhaInvite;