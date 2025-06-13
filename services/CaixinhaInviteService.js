// services/CaixinhaInviteService.js
const {getFirestore} = require('../firebaseAdmin')
const db = getFirestore();
const CaixinhaInvite = require('../models/CaixinhaInvite');
const Caixinha = require('../models/Caixinhas');
const User = require('../models/User');
const notificationService = require('../services/notificationService')
// const Membro = require('../models/Membro')
const { logger } = require('../logger');
const emailService = require('./emailService');

class CaixinhaInviteService {
  /**
   * Obtém convites recebidos por um usuário
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array>} Lista de convites recebidos
   */
  async getReceivedInvites(userId, options = {}) {
    try {
      const { status = 'pending', type = null } = options;
      
      logger.info('Buscando convites recebidos para o usuário', {
        userId,
        status,
        type
      });
      
      // Usar o método atualizado que busca diretamente na coleção do usuário
      const invites = await CaixinhaInvite.getReceivedInvites(userId, { 
        status, 
        type 
      });
      
      return invites;
    } catch (error) {
      logger.error('Erro ao buscar convites recebidos:', error);
      throw error;
    }
  }
  
  /**
   * Obtém convites enviados por um usuário
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array>} Lista de convites enviados
   */
  async getSentInvites(userId, options = {}) {
    try {
      const { status = 'pending', type = null } = options;
      
      logger.info('Buscando convites enviados pelo usuário', {
        userId,
        status,
        type
      });
      
      // Usar o método atualizado que busca diretamente na coleção do usuário
      const invites = await CaixinhaInvite.getSentInvites(userId, { 
        status, 
        type 
      });
      
      return invites;
    } catch (error) {
      logger.error('Erro ao buscar convites enviados:', error);
      throw error;
    }
  }
  
  /**
   * Método legado para compatibilidade - Redirecionando para os métodos específicos
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array>} Lista de convites
   */
  async getInvitesByUser(userId, options = {}) {
    try {
      const { direction = 'received', status = 'pending', type = null } = options;
      
      // Redirecionar para o método apropriado com base na direção
      if (direction === 'sent') {
        return this.getSentInvites(userId, { status, type });
      } else {
        return this.getReceivedInvites(userId, { status, type });
      }
    } catch (error) {
      logger.error('Erro ao buscar convites:', error);
      throw error;
    }
  }

  /**
   * Cria um convite para um usuário existente
   * @param {Object} data - Dados do convite
   * @returns {Promise<Object>} Resultado da operação
   */
  async inviteExistingMember(data) {
    try {
      // Verificar se a caixinha existe
      const caixinha = await Caixinha.getById(data.caixinhaId);
      if (!caixinha) {
        throw new Error('Caixinha não encontrada.');
      }
      
      // Verificar se o remetente tem permissão (é membro ou admin)
      const senderIsMember = await this._checkUserIsMember(data.caixinhaId, data.senderId);
      if (!senderIsMember) {
        throw new Error('Você não tem permissão para convidar membros para esta caixinha.');
      }
      
      // Verificar se o destinatário já é membro
      const targetIsMember = await this._checkUserIsMember(data.caixinhaId, data.targetId);
      if (targetIsMember) {
        throw new Error('O usuário já é membro desta caixinha.');
      }
      
      // Verificar se já existe um convite pendente para este usuário
      const pendingInvites = await CaixinhaInvite.getByCaixinhaId(data.caixinhaId, {
        status: 'pending'
      });
      
      const existingInvite = pendingInvites.find(invite => invite.targetId === data.targetId);
      if (existingInvite) {
        throw new Error('Já existe um convite pendente para este usuário.');
      }
      
      // Obter dados do remetente
      const sender = await User.getById(data.senderId);
      if (!sender) {
        throw new Error('Remetente não encontrado.');
      }
    
      // Criar o convite
      const invite = await CaixinhaInvite.create({
        caixinhaId: data.caixinhaId,
        type: 'caixinha_invite',
        status: 'pending',
        senderId: data.senderId,
        senderName: sender.nome || sender.displayName,
        targetName: data.targetName,
        targetId: data.targetId,
        message: data.message,
        createdAt: new Date()
      });
      
      // Enviar notificação para o usuário alvo
      await this._sendInviteNotification({
        caixinhaId: data.caixinhaId,
        type: 'caixinha_invite',
        userId: data.senderId,
        targetId: data.targetId,
        status: 'pending'
      });
      
      return {
        success: true,
        caxinhaInviteId: invite.id,
        message: 'Convite enviado com sucesso.'
      };
    } catch (error) {
      logger.error('Erro ao enviar convite:', error);
      throw error;
    }
  }

  /**
   * Cria um convite por email para uma pessoa que ainda não está no sistema
   * @param {Object} data - Dados do convite
   * @returns {Promise<Object>} Resultado da operação
   */
  async inviteByEmail(data) {
    try {
      // Verificar se a caixinha existe
      const caixinha = await Caixinha.getById(data.caixinhaId);
      if (!caixinha) {
        throw new Error('Caixinha não encontrada.');
      }
      
      // Verificar se o remetente tem permissão (é membro ou admin)
      const senderIsMember = await this._checkUserIsMember(data.caixinhaId, data.senderId);
      if (!senderIsMember) {
        throw new Error('Você não tem permissão para convidar membros para esta caixinha.');
      }
      
      // Verificar se já existe um convite pendente para este email
      const pendingInvites = await CaixinhaInvite.getByCaixinhaId(data.caixinhaId, {
        status: 'pending'
      });
      
      const existingInvite = pendingInvites.find(invite => invite.email === data.email);
      if (existingInvite) {
        throw new Error('Já existe um convite pendente para este email.');
      }
      
      // Obter dados do remetente
      const sender = await User.getById(data.senderId);
      if (!sender) {
        throw new Error('Remetente não encontrado.');
      }
      
      // Criar o convite
      const invite = await CaixinhaInvite.create({
        caixinhaId: data.caixinhaId,
        type: 'caixinha_email_invite',
        status: 'pending',
        senderId: data.senderId,
        senderName: sender.nome || sender.displayName,
        email: data.email,
        message: data.message,
        createdAt: new Date()
      });
      
      // Enviar email com convite
      await this._sendInviteEmail({
        caixinha,
        sender,
        email: data.email,
        message: data.message,
        caxinhaInviteId: invite.id
      });
      
      return {
        success: true,
        caxinhaInviteId: invite.id,
        message: 'Convite enviado com sucesso.'
      };
    } catch (error) {
      logger.error('Erro ao enviar convite por email:', error);
      throw error;
    }
  }

/**
 * Aceita um convite de caixinha
 * @param {string} caxinhaInviteId - ID do convite
 * @param {string} userId - ID do usuário que está aceitando
 * @returns {Promise<Object>} Resultado da operação
 */
async acceptInvite(caxinhaInviteId, userId) {
  try {
    // Procurar o convite em todas as caixinhas
    let invite = null;
    let caixinhaId = null;
    let inviteDocRef = null; // Armazenar a referência real do documento
    
    // Tentar buscar diretamente da coleção do usuário (novo método)
    try {
      const userInvites = await CaixinhaInvite.getReceivedInvites(userId, { status: 'pending' });
      const foundInvite = userInvites.find(inv => inv.id === caxinhaInviteId);
      
      if (foundInvite) {
        invite = foundInvite;
        caixinhaId = foundInvite.caixinhaId;
        
        // Verificar se o documento realmente existe no Firestore
        const tempInviteRef = db
          .collection('caixinhas')
          .doc(caixinhaId)
          .collection('pendingRequests')
          .doc(caxinhaInviteId);
        
        const inviteDoc = await tempInviteRef.get();
        if (inviteDoc.exists) {
          inviteDocRef = tempInviteRef;
        } else {
          // Documento não existe no caminho esperado, continuar busca
          invite = null;
          caixinhaId = null;
        }
      }
    } catch (error) {
      logger.warn('Erro ao buscar convite na coleção do usuário:', error);
      // Continuar para o método legado
    }
    
    // Se não encontrou na coleção do usuário, buscar manualmente em todas as caixinhas
    if (!invite || !inviteDocRef) {
      // Listagem de caixinhas para buscar o convite
      const caixinhasSnapshot = await db.collection('caixinhas').get();
      
      for (const caixinhaDoc of caixinhasSnapshot.docs) {
        const tempCaixinhaId = caixinhaDoc.id;
        
        try {
          // Buscar o convite e verificar se o documento existe
          const tempInviteRef = db
            .collection('caixinhas')
            .doc(tempCaixinhaId)
            .collection('pendingRequests')
            .doc(caxinhaInviteId);
          
          const inviteDoc = await tempInviteRef.get();
          
          if (inviteDoc.exists) {
            const inviteData = inviteDoc.data();
            
            // Verificar se o convite é para o usuário correto (se targetId estiver definido)
            if (!inviteData.targetId || inviteData.targetId === userId) {
              invite = { id: caxinhaInviteId, ...inviteData };
              caixinhaId = tempCaixinhaId;
              inviteDocRef = tempInviteRef;
              break;
            }
          }
        } catch (err) {
          logger.warn(`Erro ao buscar convite na caixinha ${tempCaixinhaId}:`, err);
          // Continuar procurando em outras caixinhas
        }
      }
    }
    
    if (!invite || !inviteDocRef) {
      throw new Error('Convite não encontrado ou já foi processado.');
    }
    
    // Verificar se o convite é para o usuário correto
    if (invite.targetId && invite.targetId !== userId) {
      throw new Error('Este convite não foi enviado para você.');
    }
    
    // Verificar se o convite já foi processado
    if (invite.status !== 'pending') {
      throw new Error(`Este convite já foi ${invite.status === 'accepted' ? 'aceito' : 'rejeitado'}.`);
    }
    
    // Verificar se o convite está expirado
    if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) {
      // Atualizar status para expirado
      await inviteDocRef.update({
        status: 'expired',
        respondedAt: new Date()
      });
      throw new Error('Este convite já expirou.');
    }
    
    // Buscar dados do usuário
    const user = await User.getById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }
    
    // Verificar se o usuário já é membro da caixinha
    const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
    const caixinhaDoc = await caixinhaRef.get();
    
    if (!caixinhaDoc.exists) {
      throw new Error('Caixinha não encontrada.');
    }
    
    const caixinhaData = caixinhaDoc.data();
    const members = caixinhaData.members || [];
    
    if (members.includes(userId)) {
      // Usuário já é membro, apenas atualizar o status do convite
      await inviteDocRef.update({
        status: 'accepted',
        respondedAt: new Date()
      });
      
      return {
        success: true,
        caixinhaId,
        message: 'Você já é membro desta caixinha.'
      };
    }
    
    // Criar batch para operações em transação
    const batch = db.batch();
    
    // 1. Atualizar status do convite (usando a referência real encontrada)
    batch.update(inviteDocRef, {
      status: 'accepted',
      respondedAt: new Date()
    });
    
    // 2. Adicionar usuário como membro da caixinha na subcoleção membros
    const membroRef = db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('membros')
      .doc();
    
    batch.set(membroRef, {
      id: membroRef.id,
      caixinhaId,
      userId,
      nome: user.nome || user.displayName,
      email: user.email,
      fotoDoPerfil: user.fotoDoPerfil,
      active: true,
      isAdmin: false,
      joinedAt: new Date(),
      role: 'membro'
    });
    
    // 3. Atualizar o array members no documento principal da caixinha
    batch.update(caixinhaRef, {
      members: [...members, userId],
      totalMembros: (caixinhaData.totalMembros || members.length) + 1
    });
    
    // 4. Adicionar referência da caixinha no documento do usuário
    const userRef = db.collection('usuario').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const targetUser = userDoc.data();
      const userCaixinhas = targetUser.caixinhas || [];
      
      // Adicionar caixinha apenas se não estiver na lista
      if (!userCaixinhas.includes(caixinhaId)) {
        batch.update(userRef, { 
          caixinhas: [...userCaixinhas, caixinhaId] 
        });
      }
    }
    
    // Executar todas as operações em transação
    await batch.commit();
    
    logger.info(`Convite ${caxinhaInviteId} aceito com sucesso para usuário ${userId} na caixinha ${caixinhaId}`);
    
    // Enviar notificação para o remetente do convite
    try {
      await this._sendInviteNotification({
        caixinhaId,
        type: 'response',
        userId: invite.senderId,
        targetId: userId,
        status: 'accepted'
      });
    } catch (notificationError) {
      logger.warn('Erro ao enviar notificação:', notificationError);
      // Não falhar a operação principal por erro de notificação
    }

    return {
      success: true,
      caixinhaId,
      message: 'Convite aceito com sucesso. Você agora é membro desta caixinha.'
    };
  } catch (error) {
    logger.error('Erro ao aceitar convite:', error);
    
    // Re-lançar com mensagem mais específica baseada no tipo de erro
    if (error.code === 5) { // NOT_FOUND
      throw new Error('Convite não encontrado ou já foi processado.');
    } else if (error.code === 6) { // ALREADY_EXISTS
      throw new Error('Você já é membro desta caixinha.');
    } else {
      throw error;
    }
  }
}

  /**
   * Rejeita um convite de caixinha
   * @param {string} caxinhaInviteId - ID do convite
   * @param {string} userId - ID do usuário que está rejeitando
   * @param {string} reason - Motivo da rejeição (opcional)
   * @returns {Promise<Object>} Resultado da operação
   */
  async rejectInvite(caxinhaInviteId, userId, reason = '') {
    try {
      // Procurar o convite (usando lógica similar ao acceptInvite)
      let invite = null;
      let caixinhaId = null;
      
      // Tentar buscar diretamente da coleção do usuário (novo método)
      try {
        const userInvites = await CaixinhaInvite.getReceivedInvites(userId, { status: 'pending' });
        const foundInvite = userInvites.find(inv => inv.id === caxinhaInviteId);
        
        if (foundInvite) {
          invite = foundInvite;
          caixinhaId = foundInvite.caixinhaId;
        }
      } catch (error) {
        logger.warn('Erro ao buscar convite na coleção do usuário:', error);
        // Continuar para o método legado
      }
      
      // Se não encontrou na coleção do usuário, buscar manualmente
      if (!invite) {
        // Listagem de caixinhas
        const caixinhasSnapshot = await db.collection('caixinhas').get();
        
        for (const caixinhaDoc of caixinhasSnapshot.docs) {
          const tempCaixinhaId = caixinhaDoc.id;
          
          try {
            const tempInvite = await CaixinhaInvite.getById(tempCaixinhaId, caxinhaInviteId);
            if (tempInvite) {
              invite = tempInvite;
              caixinhaId = tempCaixinhaId;
              break;
            }
          } catch (err) {
            // Continuar procurando em outras caixinhas
          }
        }
      }
      
      if (!invite) {
        throw new Error('Convite não encontrado.');
      }
      
      // Verificar se o convite é para o usuário correto
      if (invite.targetId && invite.targetId !== userId) {
        throw new Error('Este convite não foi enviado para você.');
      }
      
      // Verificar se o convite já foi processado
      if (invite.status !== 'pending') {
        throw new Error(`Este convite já foi ${invite.status === 'accepted' ? 'aceito' : 'rejeitado'}.`);
      }
      
      // Atualizar status do convite
      await CaixinhaInvite.updateStatus(caixinhaId, caxinhaInviteId, {
        status: 'rejected',
        respondedAt: new Date(),
        responseReason: reason
      });
      
      // Enviar notificação para o remetente do convite
      await this._sendInviteNotification({
        caixinhaId,
        type: 'response',
        userId: invite.senderId,
        targetId: userId,
        status: 'rejected'
      });
      
      return {
        success: true,
        message: 'Convite rejeitado com sucesso.'
      };
    } catch (error) {
      logger.error('Erro ao rejeitar convite:', error);
      throw error;
    }
  }

  /**
   * Cancela um convite enviado
   * @param {string} caxinhaInviteId - ID do convite
   * @param {string} userId - ID do usuário que está cancelando (deve ser o remetente)
   * @returns {Promise<Object>} Resultado da operação
   */
  async cancelInvite(caxinhaInviteId, userId) {
    try {
      // Buscar o convite diretamente da coleção do remetente
      let invite = null;
      let caixinhaId = null;
      
      // Tentar buscar diretamente da coleção do usuário (novo método)
      try {
        const sentInvites = await CaixinhaInvite.getSentInvites(userId, { status: 'pending' });
        const foundInvite = sentInvites.find(inv => inv.id === caxinhaInviteId);
        
        if (foundInvite) {
          invite = foundInvite;
          caixinhaId = foundInvite.caixinhaId;
        }
      } catch (error) {
        logger.warn('Erro ao buscar convite na coleção do usuário:', error);
        // Continuar para o método legado
      }
      
      // Se não encontrou na coleção do usuário, buscar manualmente
      if (!invite) {
        // Listagem de caixinhas
        const caixinhasSnapshot = await db.collection('caixinhas').get();
        
        for (const caixinhaDoc of caixinhasSnapshot.docs) {
          const tempCaixinhaId = caixinhaDoc.id;
          
          try {
            const tempInvite = await CaixinhaInvite.getById(tempCaixinhaId, caxinhaInviteId);
            if (tempInvite && tempInvite.senderId === userId) {
              invite = tempInvite;
              caixinhaId = tempCaixinhaId;
              break;
            }
          } catch (err) {
            // Continuar procurando em outras caixinhas
          }
        }
      }
      
      if (!invite) {
        throw new Error('Convite não encontrado.');
      }
      
      // Verificar se o usuário é o remetente do convite
      if (invite.senderId !== userId) {
        throw new Error('Apenas o remetente pode cancelar este convite.');
      }
      
      // Verificar se o convite já foi processado
      if (invite.status !== 'pending') {
        throw new Error(`Este convite já foi ${invite.status === 'accepted' ? 'aceito' : 'rejeitado'}.`);
      }
      
      // Excluir o convite
      await CaixinhaInvite.delete(caixinhaId, caxinhaInviteId);
      
      return {
        success: true,
        message: 'Convite cancelado com sucesso.'
      };
    } catch (error) {
      logger.error('Erro ao cancelar convite:', error);
      throw error;
    }
  }

  /**
   * Reenvio de convite expirado ou pendente
   * @param {string} caxinhaInviteId - ID do convite
   * @param {string} userId - ID do usuário que está reenviando
   * @param {Object} data - Dados adicionais para o reenvio
   * @returns {Promise<Object>} Resultado da operação
   */
  async resendInvite(caxinhaInviteId, userId, data = {}) {
    try {
      // Buscar o convite (usando lógica similar ao cancelInvite)
      let invite = null;
      let caixinhaId = null;
      
      // Tentar buscar diretamente da coleção do usuário (novo método)
      try {
        const sentInvites = await CaixinhaInvite.getSentInvites(userId, { status: ['pending', 'expired'] });
        const foundInvite = sentInvites.find(inv => inv.id === caxinhaInviteId);
        
        if (foundInvite) {
          invite = foundInvite;
          caixinhaId = foundInvite.caixinhaId;
        }
      } catch (error) {
        logger.warn('Erro ao buscar convite na coleção do usuário:', error);
        // Continuar para o método legado
      }
      
      if (!invite) {
        // Listagem de caixinhas
        const caixinhasSnapshot = await db.collection('caixinhas').get();
        
        for (const caixinhaDoc of caixinhasSnapshot.docs) {
          const tempCaixinhaId = caixinhaDoc.id;
          
          try {
            const tempInvite = await CaixinhaInvite.getById(tempCaixinhaId, caxinhaInviteId);
            if (tempInvite && tempInvite.senderId === userId) {
              invite = tempInvite;
              caixinhaId = tempCaixinhaId;
              break;
            }
          } catch (err) {
            // Continuar procurando em outras caixinhas
          }
        }
      }
      
      if (!invite) {
        throw new Error('Convite não encontrado.');
      }
      
      // Verificar se o usuário é o remetente do convite
      if (invite.senderId !== userId) {
        throw new Error('Apenas o remetente pode reenviar este convite.');
      }
      
      // Verificar se o convite está pendente ou expirado
      if (invite.status !== 'pending' && invite.status !== 'expired') {
        throw new Error(`Este convite não pode ser reenviado pois já foi ${invite.status}.`);
      }
      
      // Utilizar o método resendInvite do modelo atualizado
      await CaixinhaInvite.resendInvite(caixinhaId, caxinhaInviteId, {
        message: data.message
      });
      
      // Se for convite por email, reenviar o email
      if (invite.type === 'caixinha_email_invite' && invite.email) {
        const caixinha = await Caixinha.getById(caixinhaId);
        const sender = await User.getById(userId);
        
        await this._sendInviteEmail({
          caixinha,
          sender,
          email: invite.email,
          message: data.message || invite.message,
          caxinhaInviteId: invite.id,
          isResend: true
        });
      }
      
      return {
        success: true,
        message: 'Convite reenviado com sucesso.',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      };
    } catch (error) {
      logger.error('Erro ao reenviar convite:', error);
      throw error;
    }
  }

  /**
   * Busca convites por caixinha
   * @param {string} caixinhaId - ID da caixinha
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array>} Lista de convites
   */
  async getCaixinhaInvites(caixinhaId, options = {}) {
    try {
      return await CaixinhaInvite.getByCaixinhaId(caixinhaId, options);
    } catch (error) {
      logger.error('Erro ao buscar convites da caixinha:', error);
      throw error;
    }
  }

  /**
   * Detalhes de um convite específico
   * @param {string} caxinhaInviteId - ID do convite
   * @returns {Promise<Object>} Detalhes do convite
   */
  async getInviteDetails(caxinhaInviteId) {
    try {
      // Buscar em todas as caixinhas
      const caixinhasSnapshot = await db.collection('caixinhas').get();
      
      for (const caixinhaDoc of caixinhasSnapshot.docs) {
        const caixinhaId = caixinhaDoc.id;
        
        try {
          const invite = await CaixinhaInvite.getById(caixinhaId, caxinhaInviteId);
          if (invite) {
            // Adicionar informações adicionais
            const caixinha = await Caixinha.getById(caixinhaId);
            return {
              ...invite,
              caixinhaName: caixinha?.name || caixinha?.nome || 'Caixinha não encontrada'
            };
          }
        } catch (err) {
          // Continuar procurando em outras caixinhas
        }
      }
      
      throw new Error('Convite não encontrado.');
    } catch (error) {
      logger.error('Erro ao buscar detalhes do convite:', error);
      throw error;
    }
  }

  /**
   * Verifica se um usuário é membro de uma caixinha
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} userId - ID do usuário
   * @returns {Promise<boolean>} true se for membro, false caso contrário
   */
  async _checkUserIsMember(caixinhaId, userId) {
    try {
      // Verificar se é admin da caixinha
      const caixinha = await Caixinha.getById(caixinhaId);
      if (caixinha.adminId === userId) {
        logger.info('Usuário é admin da caixinha', { caixinhaId, userId });
        return true;
      }
      
      // Buscar membros da caixinha
      const membrosSnapshot = await db.collection('caixinhas').doc(caixinhaId).collection('membros').get();
      
      // Log the full snapshot for debugging
      logger.info('Snapshot de membros:', { 
        caixinhaId, 
        count: membrosSnapshot.size,
        empty: membrosSnapshot.empty 
      });
      
      for (const membroDoc of membrosSnapshot.docs) {
        const membro = membroDoc.data();
        logger.info('Verificando membro:', { 
          membro,
          userId: membro.userId, 
          requestedUserId: userId,
          status: membro.status,
          match: membro.userId === userId && membro.status === 'ativo'
        });
        
        if (membro.userId === userId && membro.status === 'ativo') {
          logger.info('Usuário é membro ativo da caixinha', { caixinhaId, userId });
          return true;
        }
      }
      
      // If we get here, the user is not a member
      logger.info('Usuário não é membro da caixinha', { caixinhaId, userId });
      return false;
    } catch (error) {
      console.error('Erro ao verificar se usuário é membro:', error);
      return false;
    }
  }

  /**
   * Envia email de convite
   * @param {Object} data - Dados do email
   * @returns {Promise<void>}
   */
  async _sendInviteEmail(data) {
    try {
      const { caixinha, sender, email, message, caxinhaInviteId, isResend = false } = data;
      
      const inviteLink = `${process.env.FRONTEND_URL}/convite/${caxinhaInviteId}`;
      const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias
      
      // Preparar dados para o template
      const templateData = {
        caixinhaNome: caixinha.nome,
        caixinhaDescricao: caixinha.descricao,
        contribuicaoMensal: caixinha.contribuicaoMensal,
        senderName: sender.nome || sender.displayName,
        senderPhotoURL: sender.fotoPerfil || 'https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/default-profile.png',
        recipientName: '',
        message: message,
        inviteLink: inviteLink,
        expirationDate: expirationDate.toLocaleDateString('pt-BR')
      };
      
      // Enviar email usando o serviço de email existente
      await emailService.sendEmail({
        to: email,
        subject: isResend 
          ? `Lembrete: Convite para participar da Caixinha "${caixinha.nome}"`
          : `Convite para participar da Caixinha "${caixinha.nome}"`,
        templateType: 'caixinha_invite',
        data: templateData,
        userId: sender.uid,
        reference: caxinhaInviteId,
        referenceType: 'caixinha_invite'
      });
      
      return true;
    } catch (error) {
      logger.error('Erro ao enviar email de convite:', error);
      // Não propagar o erro para não interromper o fluxo principal
      return false;
    }
  }
  
  /**
   * Reenvia email de convite
   * @param {string} caxinhaInviteId - ID do convite
   * @param {string} caixinhaId - ID da caixinha
   * @returns {Promise<Object>} Resultado da operação
   */
  async resendInviteEmail(caxinhaInviteId, caixinhaId) {
    try {
      // Obter dados do convite
      const invite = await CaixinhaInvite.getById(caixinhaId, caxinhaInviteId);
      
      if (!invite) {
        throw new Error('Convite não encontrado.');
      }
      
      if (invite.type !== 'caixinha_email_invite' || !invite.email) {
        throw new Error('Este convite não foi enviado por email.');
      }
      
      // Obter dados adicionais necessários
      const caixinha = await Caixinha.getById(caixinhaId);
      const sender = await User.getById(invite.senderId);
      
      // Reenviar o email
      await this._sendInviteEmail({
        caixinha,
        sender,
        email: invite.email,
        message: invite.message,
        caxinhaInviteId: invite.id,
        isResend: true
      });

      // Utilizar o método resendInvite do modelo atualizado
      await CaixinhaInvite.resendInvite(caixinhaId, caxinhaInviteId, {});
      
      return {
        success: true,
        message: 'Email de convite reenviado com sucesso.'
      };
    } catch (error) {
      logger.error('Erro ao reenviar email de convite:', error);
      throw error;
    }
  }
  
/**
 * Envia notificação para o usuário sobre o resultado do convite
 * @param {Object} data - Dados da notificação
 * @returns {Promise<void>}
 */
async _sendInviteNotification(data) {
  try {
    const { caixinhaId, type, userId, targetId, status } = data;
    
    // Obter dados da caixinha
    const caixinha = await Caixinha.getById(caixinhaId);
    if (!caixinha || !caixinha.name) {
      logger.warn('Caixinha não encontrada ou sem nome, não enviando notificação', {
        service: 'CaixinhaInviteService',
        function: '_sendInviteNotification',
        caixinhaId
      });
      return;
    }
    
    // Determinar destinatário da notificação
    const recipientId = type === 'new_invite' ? targetId : userId;
    
    // Determinar título e conteúdo baseado no status
    let title, content;
    
    if (status === 'accepted') {
      title = 'Convite aceito';
      content = `Seu convite para a Caixinha "${caixinha.name}" foi aceito.`;
    } else if (status === 'rejected') {
      title = 'Convite rejeitado';
      content = `Seu convite para a Caixinha "${caixinha.name}" foi rejeitado.`;
    } else if (status === 'pending' && type === 'new_invite') {
      title = 'Novo convite';
      content = `Você recebeu um convite para participar da Caixinha "${caixinha.name}".`;
    }
    
    // Enviar a notificação se título e conteúdo estiverem definidos
    if (title && content && recipientId) {
      logger.info('Enviando notificação de convite', {
        service: 'CaixinhaInviteService',
        function: '_sendInviteNotification',
        recipientId,
        title,
        type: 'caixinha_invite'
      });
      
      await notificationService.createNotification(
        recipientId, // Primeiro parâmetro: userId
        {
          // Segundo parâmetro: notificationData
          type: 'caixinha_invite',
          content,
          url: `/caixinha/${caixinhaId}`,
          data: {
            caixinhaId,
            action: status
          }
        }
      );
    } else {
      logger.warn('Dados insuficientes para envio de notificação', {
        service: 'CaixinhaInviteService',
        function: '_sendInviteNotification',
        hasTitle: Boolean(title),
        hasContent: Boolean(content),
        hasRecipient: Boolean(recipientId)
      });
    }
  } catch (error) {
    logger.error('Erro ao enviar notificação de convite', {
      service: 'CaixinhaInviteService',
      function: '_sendInviteNotification',
      error: error.message,
      stack: error.stack,
      data
    });
    // Não propagar o erro para não interromper o fluxo principal
  }
}

  /**
   * Busca e marca convites expirados
   * @returns {Promise<Object>} Estatísticas da operação
   */
  async checkExpiredInvites() {
    try {
      const updatedCount = await CaixinhaInvite.checkExpiredInvites();
      
      return {
        success: true,
        updatedCount,
        message: `${updatedCount} convites marcados como expirados.`
      };
    } catch (error) {
      logger.error('Erro ao verificar convites expirados:', error);
      throw error;
    }
  }

  /**
   * Migra convites existentes para a nova estrutura
   * @returns {Promise<Object>} Estatísticas da migração
   */
  async migrateInvitesToNewStructure() {
    try {
      const stats = await CaixinhaInvite.migrateToNewStructure();
      
      return {
        success: true,
        stats,
        message: `${stats.migrated}/${stats.total} convites migrados para a nova estrutura.`
      };
    } catch (error) {
      logger.error('Erro ao migrar convites:', error);
      throw error;
    }
  }
}

module.exports = new CaixinhaInviteService();