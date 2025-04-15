// services/inviteService.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const moment = require('moment');
const { logger } = require('../logger');
const Invite = require('../models/Invite');
const User = require('../models/User');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const { HttpError } = require('../utils/errors');
const { getFirestore } = require('../firebaseAdmin');

// Configurações
const INVITE_EXPIRATION_DAYS = 5;
const RESEND_COOLDOWN_HOURS = 1;
const MAX_PENDING_INVITES_PER_USER = 10;
const BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'https://localhost:3000'
  : 'https://eloscloud.com';

/**
 * Verifica a existência e validade de um convite
 * @param {string} inviteId - ID do convite a ser verificado
 * @param {string} email - Email opcional para verificação adicional
 * @returns {Promise<Object>} Informações sobre a validade do convite
 */
const checkInvite = async (inviteId, email = null) => {
  logger.info('Verificando convite', { 
    service: 'inviteService', 
    function: 'checkInvite', 
    inviteId 
  });

  try {
    const { invite } = await Invite.getById(inviteId);
    
    if (!invite) {
      return { valid: false, message: 'Convite não encontrado' };
    }
    
    if (invite.status !== 'pending') {
      return { valid: false, message: 'Convite já utilizado ou cancelado' };
    }
    
    // Verificar expiração
    const createdAt = moment(invite.createdAt.toDate());
    const expiresAt = createdAt.add(INVITE_EXPIRATION_DAYS, 'days');
    
    if (moment().isAfter(expiresAt)) {
      return { valid: false, message: 'Convite expirado' };
    }
    
    // Verificar email se fornecido
    if (email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return { valid: false, message: 'Email não corresponde ao convite' };
    }
    
    // Convite válido
    return {
      valid: true,
      invite: {
        email: invite.email,
        senderName: invite.senderName,
        friendName: invite.friendName,
        status: invite.status,
        createdAt: createdAt.format('DD/MM/YYYY')
      }
    };
  } catch (error) {
    logger.error('Erro ao verificar convite', {
      service: 'inviteService',
      function: 'checkInvite',
      inviteId,
      error: error.message
    });
    
    throw new HttpError('Erro ao verificar convite', 500);
  }
};

/**
 * Valida um convite com email e nome para iniciar processo de registro
 * @param {string} inviteId - ID do convite a validar
 * @param {string} email - Email do convidado
 * @param {string} nome - Nome do convidado
 * @returns {Promise<Object>} Token de registro e informações do remetente
 */
const validateInvite = async (inviteId, email, nome) => {
  logger.info('Validando convite', {
    service: 'inviteService',
    function: 'validateInvite',
    inviteId,
    email
  });
  
  try {
    // Verificar existência e validade do convite
    const checkResult = await checkInvite(inviteId, email);
    
    if (!checkResult.valid) {
      throw new HttpError(checkResult.message, 400);
    }
    
    const { invite, inviteRef } = await Invite.getById(inviteId);
    
    // Verificar nome do amigo
    if (invite.friendName.toLowerCase() !== nome.toLowerCase()) {
      throw new HttpError('Nome não corresponde ao convite', 400);
    }
    
    // Atualizar status do convite para 'validated' (etapa intermediária)
    await inviteRef.update({
      status: 'validated',
      validatedAt: new Date()
    });
    
    // Buscar dados do remetente para conexão
    const sender = await User.getById(invite.senderId);
    
    const inviter = {
      id: invite.senderId,
      nome: sender.nome,
      email: sender.email,
      foto: sender.fotoDoPerfil
    };
    
    // Gerar token de registro temporário
    const registrationToken = generateRegistrationToken(inviteId, email);
    
    return {
      inviteId,
      inviter,
      registrationToken
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    
    logger.error('Erro ao validar convite', {
      service: 'inviteService',
      function: 'validateInvite',
      inviteId,
      email,
      error: error.message
    });
    
    throw new HttpError('Erro ao validar convite', 500);
  }
};

/**
 * Invalida um convite após uso completo (durante registro)
 * @param {string} inviteId - ID do convite a invalidar
 * @param {string} newUserId - ID do novo usuário registrado
 * @returns {Promise<Object>} Status da operação
 */
const invalidateInvite = async (inviteId, newUserId) => {
  const db = getFirestore();
  
  logger.info('Invalidando convite após uso', {
    service: 'inviteService',
    function: 'invalidateInvite',
    inviteId,
    newUserId
  });
  
  try {
    // Carregar dados do convite
    const { invite, inviteRef } = await Invite.getById(inviteId);
    
    if (!invite) {
      throw new HttpError('Convite não encontrado', 404);
    }
    
    if (invite.status === 'used') {
      throw new HttpError('Convite já utilizado', 400);
    }
    
    // Usar transação para garantir atomicidade das operações
    await db.runTransaction(async (transaction) => {
      // 1. Marcar convite como usado
      transaction.update(inviteRef, {
        status: 'used',
        usedAt: new Date(),
        usedBy: newUserId
      });
      
      // 2. Configurar relacionamento de ancestralidade
      const newUserRef = db.collection('usuario').doc(newUserId);
      const ancestralidadeRef = newUserRef.collection('ancestralidade').doc();
      
      transaction.set(ancestralidadeRef, {
        inviteId: inviteId,
        senderId: invite.senderId,
        dataAceite: new Date(),
        senderName: invite.senderName,
        senderPhotoURL: invite.senderPhotoURL
      });
      
      // 3. Adicionar à lista de descendentes do remetente
      const senderRef = db.collection('usuario').doc(invite.senderId);
      const descendentesRef = senderRef.collection('descendentes').doc();
      
      transaction.set(descendentesRef, {
        userId: newUserId,
        nome: invite.friendName,
        email: invite.email,
        dataAceite: new Date()
      });
      
      // 4. Adicionar moedas de boas-vindas
      const comprasRef = newUserRef.collection('compras').doc();
      
      transaction.set(comprasRef, {
        quantidade: 5000,
        valorPago: 0,
        dataCompra: new Date(),
        meioPagamento: 'oferta-boas-vindas'
      });
      
      // 5. Atualizar saldo do usuário
      transaction.update(newUserRef, {
        saldoElosCoins: 5000
      });
    });
    
    // Enviar email de boas-vindas
    // await sendWelcomeEmail(invite.email, invite.friendName);
    
    await emailService.sendEmail({
      to: invite.email,
      subject: '[ElosCloud] Embarque realizado com sucesso',
      userId: newUserRef.uid,
      inviteId,
      templateType: 'welcome'
    });

const notificationData = {
  type: 'convite',
  content: `${invite.friendName} aceitou seu convite e criou uma conta`,
  url: `/profile/${newUserId}`
}

const userId = invite.senderId;

    // Notificar remetente
    await notificationService.createNotification(userId, notificationData);
    
    return { success: true };
  } catch (error) {
    logger.error('Erro ao invalidar convite', {
      service: 'inviteService',
      function: 'invalidateInvite',
      inviteId,
      newUserId,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao processar registro com convite', 500);
  }
};

/**
 * Verifica se um usuário pode enviar convite para determinado email
 * @param {string} userId - ID do usuário
 * @param {string} email - Email para o qual enviar convite
 * @returns {Promise<Object>} Indica se pode enviar e dados do usuário
 */
const canSendInvite = async (userId, email) => {
  logger.info('Verificando se pode enviar convite', {
    service: 'inviteService',
    function: 'canSendInvite',
    userId,
    email
  });
  
  try {
    // 1. Verificar se o usuário existe
    const user = await User.getById(userId);
    
    if (!user) {
      throw new HttpError('Usuário não encontrado', 404);
    }
    
    // 2. Verificar limite de convites pendentes
    const pendingInvites = await Invite.getPendingBySender(userId);
    
    if (pendingInvites.length >= MAX_PENDING_INVITES_PER_USER) {
      return {
        canSend: false,
        message: `Você atingiu o limite de ${MAX_PENDING_INVITES_PER_USER} convites pendentes`
      };
    }
    
    // 3. Verificar se já existe convite para este email
    const existingInvite = await Invite.findByEmail(email);
    
    if (!existingInvite) {
      // Não existe convite, pode enviar
      return {
        canSend: true,
        user
      };
    }
    
    // 4. Se já existe convite, verificar status
    if (existingInvite.status === 'used') {
      return {
        canSend: false,
        message: 'Este email já foi registrado através de um convite'
      };
    }
    
    if (existingInvite.status === 'pending') {
      // Verificar se é do mesmo remetente
      if (existingInvite.senderId !== userId) {
        return {
          canSend: false,
          message: 'Já existe um convite pendente para este email enviado por outro usuário'
        };
      }
      
      // Verificar tempo desde último reenvio
      const lastSentAt = existingInvite.lastSentAt ? moment(existingInvite.lastSentAt.toDate()) : null;
      
      if (lastSentAt && moment().diff(lastSentAt, 'hours') < RESEND_COOLDOWN_HOURS) {
        return {
          canSend: false,
          message: `Você já enviou um convite para este email recentemente. Aguarde ${RESEND_COOLDOWN_HOURS} hora(s) para reenviar.`
        };
      }
      
      // Pode reenviar
      return {
        canSend: true,
        user,
        existingInvite
      };
    }
    
    // Convite cancelado ou expirado, pode enviar novo
    return {
      canSend: true,
      user
    };
  } catch (error) {
    logger.error('Erro ao verificar permissão para enviar convite', {
      service: 'inviteService',
      function: 'canSendInvite',
      userId,
      email,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao verificar permissão para enviar convite', 500);
  }
};

/**
 * Gera e envia novo convite
 * @param {string} userId - ID do usuário remetente
 * @param {string} email - Email do destinatário
 * @param {string} friendName - Nome do destinatário
 * @returns {Promise<Object>} Informações do convite gerado
 */
const generateAndSendInvite = async (userId, email, friendName) => {
  const db = getFirestore();
  
  logger.info('Gerando novo convite', {
    service: 'inviteService',
    function: 'generateAndSendInvite',
    userId,
    email,
    friendName
  });
  
  try {
    // Verificar permissão de envio
    const { canSend, user, existingInvite } = await canSendInvite(userId, email);
    
    if (!canSend) {
      throw new HttpError('Não é possível enviar convite para este email no momento', 400);
    }
    
    // Se já existe um convite pendente, apenas reenviar
    if (existingInvite) {
      return await resendInvite(existingInvite.inviteId, userId);
    }
    
    // Gerar novo convite
    const inviteId = uuidv4();
    const inviteData = {
      inviteId,
      email: email.toLowerCase(),
      friendName,
      senderId: userId,
      senderName: user.nome,
      senderPhotoURL: user.fotoDoPerfil || '',
      status: 'pending',
      createdAt: new Date(),
      lastSentAt: new Date(),
      resendCount: 0
    };
    
    // Criar documento do convite
    const inviteRef = db.collection('convites').doc();
    
    // Criar QR Code
    const qrCodeUrl = `${BASE_URL}/invite/validate/${inviteId}`;
    const qrCodeBuffer = await QRCode.toDataURL(qrCodeUrl);
    
    // Adicionar hash para segurança
    const hashedInviteId = crypto
      .createHash('sha256')
      .update(inviteId)
      .digest('hex');
    
    const maskedHashedInviteId = hashedInviteId.substring(0, 4) + 
      '******' + 
      hashedInviteId.substring(hashedInviteId.length - 4);
    
    // Definir prazo de expiração
    const expiresAt = moment().add(INVITE_EXPIRATION_DAYS, 'days');
    
    // Usar transação para criar convite e registrar no sistema de emails
    await db.runTransaction(async (transaction) => {
      // 1. Salvar o convite
      transaction.set(inviteRef, {
        ...inviteData,
        expiresAt: expiresAt.toDate()
      });
    });
    
    // ALTERAÇÃO AQUI: Usando o novo sistema de email
    // ----------------------------------------
    // Enviar email usando o novo serviço de email com template
    const emailService = require('../services/emailService');
    const emailResult = await emailService.sendEmail({
      to: email,
      subject: '[ElosCloud] Bilhete de Embarque',
      templateType: 'convite',
      data: {
        inviteId,
        qrCodeBuffer,
        maskedHashedInviteId,
        senderName: user.nome,
        senderPhotoURL: user.fotoDoPerfil || '',
        friendName,
        expiresAt: expiresAt.format('DD/MM/YYYY')
      },
      userId,
      reference: inviteId,
      referenceType: 'invite'
    });
    // ----------------------------------------

    if (!emailResult.success) {
      logger.warn('Erro ao enviar email de convite', {
        error: emailResult.error,
        inviteId,
        email
      });
      // Continuamos mesmo com erro no email, pois o convite foi criado
    }
    const notificationData = {
      type: 'convite',
      content: `Convite enviado com sucesso para ${friendName}`,
      url: '/invites',
      inviteId
    }

    // Criar notificação para o remetente
    await notificationService.createNotification(userId, notificationData);
    
    logger.info('Convite criado e enviado com sucesso', {
      service: 'inviteService',
      function: 'generateAndSendInvite',
      inviteId,
      email
    });
    
    return {
      inviteId,
      email,
      friendName,
      expiresAt: expiresAt.format('DD/MM/YYYY')
    };
  } catch (error) {
    logger.error('Erro ao gerar e enviar convite', {
      service: 'inviteService',
      function: 'generateAndSendInvite',
      userId,
      email,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao gerar e enviar convite', 500);
  }
};

/**
 * Reenvia um convite existente
 * @param {string} inviteId - ID do convite a reenviar
 * @param {string} userId - ID do usuário remetente
 * @returns {Promise<Object>} Status da operação
 */
const resendInvite = async (inviteId, userId) => {
  logger.info('Reenviando convite', {
    service: 'inviteService',
    function: 'resendInvite',
    inviteId,
    userId
  });
  
  try {
    // Carregar o convite
    const { invite, inviteRef } = await Invite.getById(inviteId);
    
    if (!invite) {
      throw new HttpError('Convite não encontrado', 404);
    }
    
    // Verificar propriedade
    if (invite.senderId !== userId) {
      throw new HttpError('Você não tem permissão para reenviar este convite', 403);
    }
    
    // Verificar status
    if (invite.status !== 'pending') {
      throw new HttpError(`Convite não pode ser reenviado: ${invite.status}`, 400);
    }
    
    // Verificar tempo desde último envio
    const lastSentAt = invite.lastSentAt ? moment(invite.lastSentAt.toDate()) : null;
    
    if (lastSentAt && moment().diff(lastSentAt, 'hours') < RESEND_COOLDOWN_HOURS) {
      throw new HttpError(
        `Aguarde ${RESEND_COOLDOWN_HOURS} hora(s) antes de reenviar este convite`,
        429
      );
    }
    
    // Carregar dados do remetente
    const sender = await User.getById(userId);
    
    // Criar QR Code
    const qrCodeUrl = `${BASE_URL}/invite/validate/${inviteId}`;
    const qrCodeBuffer = await QRCode.toDataURL(qrCodeUrl);
    
    // Preparar hash para segurança
    const hashedInviteId = crypto
      .createHash('sha256')
      .update(inviteId)
      .digest('hex');
    
    const maskedHashedInviteId = hashedInviteId.substring(0, 4) + 
      '******' + 
      hashedInviteId.substring(hashedInviteId.length - 4);
    
    // Atualizar o convite
    await inviteRef.update({
      lastSentAt: new Date(),
      resendCount: (invite.resendCount || 0) + 1
    });
    
    // Gerar e enviar email de lembrete
    const emailContent = await prepareReminderEmailContent({
      inviteId,
      qrCodeBuffer,
      maskedHashedInviteId,
      senderName: sender.nome,
      senderPhotoURL: sender.fotoDoPerfil || '',
      friendName: invite.friendName
    });
    
    await emailService.sendEmail({
      to: invite.email,
      subject: '[ElosCloud] Lembrete de Convite',
      content: emailContent,
      userId,
      inviteId,
      type: 'convite_lembrete'
    });
    
    // Criar notificação
    await notificationService.createNotification(userId, {
      type: 'convite_lembrete',
      conteudo: `Lembrete de convite enviado para ${invite.friendName}`,
      url: '/invites',
      inviteId
    });
    
    logger.info('Convite reenviado com sucesso', {
      service: 'inviteService',
      function: 'resendInvite',
      inviteId,
      email: invite.email
    });
    
    return {
      inviteId,
      email: invite.email,
      friendName: invite.friendName,
      resendCount: (invite.resendCount || 0) + 1
    };
  } catch (error) {
    logger.error('Erro ao reenviar convite', {
      service: 'inviteService',
      function: 'resendInvite',
      inviteId,
      userId,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao reenviar convite', 500);
  }
};

/**
 * Recupera convites enviados por um usuário
 * @param {string} userId - ID do usuário remetente
 * @returns {Promise<Array>} Lista de convites enviados
 */
const getSentInvites = async (userId) => {
  logger.info('Buscando convites enviados', {
    service: 'inviteService',
    function: 'getSentInvites',
    userId
  });
  
  if (!userId) {
    throw new HttpError('ID do usuário é obrigatório', 400);
  }
  
  try {
    const invites = await Invite.getBySenderId(userId);
    
    // Processar convites para adicionar metadados úteis
    return invites.map(invite => {
      const createdAt = moment(invite.createdAt.toDate());
      const expiresAt = createdAt.clone().add(INVITE_EXPIRATION_DAYS, 'days');
      const isExpired = invite.status === 'pending' && moment().isAfter(expiresAt);
      
      return {
        ...invite,
        expiresAt: expiresAt.format('DD/MM/YYYY'),
        timeRemaining: isExpired ? 'Expirado' : expiresAt.fromNow(),
        statusDisplay: isExpired ? 'expired' : invite.status,
        canResend: 
          invite.status === 'pending' && 
          !isExpired && 
          (!invite.lastSentAt || moment().diff(moment(invite.lastSentAt.toDate()), 'hours') >= RESEND_COOLDOWN_HOURS)
      };
    });
  } catch (error) {
    logger.error('Erro ao buscar convites enviados', {
      service: 'inviteService',
      function: 'getSentInvites',
      userId,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao buscar convites enviados', 500);
  }
};

/**
 * Cancela um convite que ainda não foi utilizado
 * @param {string} inviteId - ID do convite a cancelar
 * @param {string} userId - ID do usuário que está cancelando
 * @returns {Promise<Object>} Status da operação
 */
const cancelInvite = async (inviteId, userId) => {
  logger.info('Cancelando convite', {
    service: 'inviteService',
    function: 'cancelInvite',
    inviteId,
    userId
  });
  
  try {
    // Carregar o convite
    const { invite, inviteRef } = await Invite.getById(inviteId);
    
    if (!invite) {
      throw new HttpError('Convite não encontrado', 404);
    }
    
    // Verificar propriedade
    if (invite.senderId !== userId) {
      throw new HttpError('Você não tem permissão para cancelar este convite', 403);
    }
    
    // Verificar status
    if (invite.status !== 'pending') {
      throw new HttpError(`Convite não pode ser cancelado: ${invite.status}`, 400);
    }
    
    // Cancelar o convite
    await inviteRef.update({
      status: 'canceled',
      canceledAt: new Date(),
      canceledBy: userId
    });
    
    logger.info('Convite cancelado com sucesso', {
      service: 'inviteService',
      function: 'cancelInvite',
      inviteId
    });
    
    return { success: true };
  } catch (error) {
    logger.error('Erro ao cancelar convite', {
      service: 'inviteService',
      function: 'cancelInvite',
      inviteId,
      userId,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao cancelar convite', 500);
  }
};

/**
 * Obtém detalhes de um convite específico
 * @param {string} inviteId - ID do convite
 * @returns {Promise<Object>} Detalhes do convite
 */
const getInviteById = async (inviteId) => {
  logger.info('Buscando convite por ID', {
    service: 'inviteService',
    function: 'getInviteById',
    inviteId
  });
  
  try {
    const { invite } = await Invite.getById(inviteId);
    
    if (!invite) {
      throw new HttpError('Convite não encontrado', 404);
    }
    
    // Formatar datas para exibição
    const createdAt = moment(invite.createdAt.toDate());
    const expiresAt = createdAt.clone().add(INVITE_EXPIRATION_DAYS, 'days');
    const lastSentAt = invite.lastSentAt ? moment(invite.lastSentAt.toDate()) : null;
    
    return {
      ...invite,
      createdAt: createdAt.format('DD/MM/YYYY HH:mm'),
      expiresAt: expiresAt.format('DD/MM/YYYY'),
      lastSentAt: lastSentAt ? lastSentAt.format('DD/MM/YYYY HH:mm') : null,
      timeRemaining: expiresAt.fromNow()
    };
  } catch (error) {
    logger.error('Erro ao buscar convite por ID', {
      service: 'inviteService',
      function: 'getInviteById',
      inviteId,
      error: error.message
    });
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Erro ao buscar convite', 500);
  }
};

// ========== FUNÇÕES AUXILIARES INTERNAS ==========

/**
 * Gera um token JWT para o processo de registro
 * @param {string} inviteId - ID do convite
 * @param {string} email - Email do convidado
 * @returns {string} Token JWT
 */
const generateRegistrationToken = (inviteId, email) => {
  // Usar um secret diferente do JWT de autenticação principal
  const secret = process.env.JWT_INVITE_SECRET || process.env.JWT_SECRET;
  
  return jwt.sign(
    {
      inviteId,
      email,
      purpose: 'registration',
      iat: Math.floor(Date.now() / 1000)
    },
    secret,
    {
      expiresIn: `${INVITE_EXPIRATION_DAYS}d`
    }
  );
};

// /**
//  * Prepara o conteúdo HTML para email de convite
//  * @param {Object} data - Dados para o template
//  * @returns {Promise<string>} Conteúdo HTML do email
//  */
// const prepareInviteEmailContent = async (data) => {
//   const friendFoto = process.env.DEFAULT_PROFILE_IMG || "https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/default-profile.png";
  
//   // Gera o conteúdo HTML do email
//   return `
//   <table width="100%" border="0" cellspacing="0" cellpadding="0">
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
//           <tr>
//             <td align="left" valign="top" style="padding: 10px;">
//               <img src="${data.senderPhotoURL}" alt="${data.senderName}" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
//             </td>
//             <td align="left" valign="top">
//               <p style="margin: 0;"><strong>Enviado Por:</strong></p>
//               <p style="margin: 0; font-size: 20px;">${data.senderName}</p>
//             </td>
//           </tr>
//         </table>
//       </td>
//     </tr>
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
//           <tr>
//             <td align="left" valign="top" style="padding: 10px;">
//               <img src="${friendFoto}" alt="${data.friendName}" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
//             </td>
//             <td align="left" valign="top">
//               <p style="margin: 0;"><strong>Convite para:</strong></p>
//               <p style="margin: 0; font-size: 20px;">${data.friendName}</p>
//             </td>
//           </tr>
//         </table>
//       </td>
//     </tr>
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; color: rgba(0, 0, 255, 0.5)">
//           <tr>
//             <td>
//               <p><strong>DESTINO:</strong> ELOSCLOUD</p>
//               <p><strong>PASSAGEIRO:</strong> ${data.friendName}</p>
//               <p><strong>CREDENCIAL:</strong> ${data.maskedHashedInviteId}</p>
//               <p><strong>GERADO EM:</strong> ${new Date().toLocaleDateString()}</p>
//               <p><strong>EXPIRA EM:</strong> ${data.expiresAt}</p>
//             </td>
//           </tr>
//         </table>
//       </td>
//     </tr>
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <div class="highlight" style="background-color: #ffcc00; padding: 10px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 20px; font-weight: bold; color: #333333;">
//           Instruções
//         </div>
//         <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
//           <tr>
//             <td align="left" valign="top" style="padding: 10px;">
//               <table width="100%" border="0" cellspacing="0" cellpadding="0">
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10112; Aceitar</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Clique no botão Aceitar Convite</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10113; Validar E-mail</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Informe o e-mail que você recebeu o convite</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10114; Validar Nome</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Informe o seu nome exatamente como neste convite</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10115; Validar Convite</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Clique no botão Validar Convite</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10116; Registrar</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Na página de registro escolha sua forma preferida</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10117; Confirmar Registro</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Clique no botão Criar Conta</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td width="20%" align="left" valign="top">
//                     <p style="margin: 0; font-size: 18px;"><strong>&#10118; Boas-vindas</strong></p>
//                     <p style="margin: 0; font-size: 16px;">Parabéns! Um e-mail de boas-vindas será enviado</p>
//                   </td>
//                 </tr>
//               </table>
//             </td>
//           </tr>
//         </table>
//       </td>
//     </tr>
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <a href="${BASE_URL}/invite/validate/${data.inviteId}" style="display: block; width: 200px; margin: 20px auto; padding: 10px; background-color: #fd8c5e; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-size: 16px;">
//           Aceitar Convite
//         </a>
//       </td>
//     </tr>
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <img src="${data.qrCodeBuffer}" alt="QR Code" width="150" height="150" style="display: block; margin: auto;" />
//       </td>
//     </tr>
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
//           Clique no botão ou escaneie o QRCode para validar o seu convite e se registrar!
//         </p>
//         <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
//           Não se interessou? Sem problemas, basta ignorar este e-mail.
//         </p>
//       </td>
//     </tr>
//   </table>
//   `;
// };

// /**
//  * Prepara o conteúdo HTML para email de lembrete de convite
//  * @param {Object} data - Dados para o template
//  * @returns {Promise<string>} Conteúdo HTML do email
//  */
// const prepareReminderEmailContent = async (data) => {
//   return `
//   <!DOCTYPE html>
//   <html lang="pt-BR">
//   <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>Lembrete de Convite - ElosCloud</title>
//     <style>
//       body {
//         font-family: 'Poppins', Arial, sans-serif;
//         background-color: #f4f4f4;
//         margin: 0;
//         padding: 0;
//         color: #333333;
//       }
//       .email-container {
//         max-width: 600px;
//         margin: auto;
//         background-color: #ffffff;
//         border-radius: 8px;
//         box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
//         overflow: hidden;
//       }
//       .email-header {
//         background-color: #345C72;
//         color: white;
//         text-align: center;
//         padding: 20px;
//         font-size: 24px;
//         font-weight: bold;
//       }
//       .email-body {
//         padding: 20px;
//         font-size: 16px;
//         color: #333333;
//       }
//       .email-body p {
//         margin: 10px 0;
//       }
//       .cta-button {
//         display: block;
//         width: 80%;
//         margin: 20px auto;
//         padding: 12px;
//         background-color: #fd8c5e;
//         color: white;
//         text-align: center;
//         text-decoration: none;
//         border-radius: 6px;
//         font-size: 18px;
//       }
//       .highlight {
//         background-color: #ffcc00;
//         padding: 10px;
//         border-radius: 5px;
//         text-align: center;
//         font-weight: bold;
//       }
//       .email-footer {
//         background-color: #333333;
//         color: white;
//         text-align: center;
//         padding: 15px;
//         font-size: 14px;
//       }
//       .email-footer a {
//         color: #ffffff;
//         text-decoration: underline;
//         margin: 0 5px;
//       }
//     </style>
//   </head>
//   <body>
//     <table width="100%" border="0" cellspacing="0" cellpadding="0">
//       <tr>
//         <td align="center" valign="top">
//           <table class="email-container" border="0" cellspacing="0" cellpadding="0">
//             <tr>
//               <td class="email-header">
//                 Lembrete de Convite - ElosCloud
//               </td>
//             </tr>
//             <tr>
//               <td class="email-body">
//                 <p>Olá ${data.friendName},</p>
//                 <p>Você recebeu um convite de <strong>${data.senderName}</strong> para se juntar ao ElosCloud!</p>
//                 <p>Não perca a oportunidade de fazer parte da nossa rede. Clique no botão abaixo para aceitar o convite:</p>
//                 <a href="${BASE_URL}/invite/validate/${data.inviteId}" class="cta-button">Aceitar Convite</a>
//                 <p class="highlight">Este convite é válido por tempo limitado. Não perca!</p>
//                 <p>Você também pode escanear o QR Code abaixo:</p>
//                 <div style="text-align: center;">
//                   <img src="${data.qrCodeBuffer}" alt="QR Code" width="150" height="150" style="display: block; margin: auto;" />
//                 </div>
//                 <p>Atenciosamente,</p>
//                 <p>Equipe ElosCloud</p>
//               </td>
//             </tr>
//             <tr>
//               <td class="email-footer">
//                 Copyright &copy; ${new Date().getFullYear()} | ElosCloud
//                 <br>
//                 <a href="${BASE_URL}">Visitar ElosCloud</a> |
//                 <a href="${BASE_URL}/terms">Termos de Uso</a> |
//                 <a href="${BASE_URL}/privacy">Política de Privacidade</a>
//                 <p style="font-size: 12px; margin: 10px 0 0 0;">
//                   Ao aceitar o convite, alguns dados serão compartilhados com o remetente. Consulte os termos.
//                 </p>
//               </td>
//             </tr>
//           </table>
//         </td>
//       </tr>
//     </table>
//   </body>
//   </html>
//   `;
// };

// /**
//  * Prepara o conteúdo HTML para email de boas-vindas
//  * @param {string} email - Email do destinatário
//  * @param {string} nome - Nome do destinatário
//  * @returns {Promise<void>} 
//  */
// const sendWelcomeEmail = async (email, nome) => {
//   const logoURL = process.env.LOGO_URL || "https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/logo.png";
  
//   const welcomeContent = `
//   <table width="100%" border="0" cellspacing="0" cellpadding="0">
//   <tr>
//     <td align="center" valign="top" style="padding: 10px;">
//       <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
//         <tr>
//           <td align="left" valign="top" style="padding: 10px;">
//             <img src="${logoURL}" alt="ElosCloud" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
//           </td>
//           <td align="left" valign="top">
//             <p style="margin: 0;"><strong>Bem-vindo à ElosCloud!</strong></p>
//             <p style="margin: 0; font-size: 20px;">Sua conta foi criada com sucesso.</p>
//           </td>
//         </tr>
//       </table>
//     </td>
//   </tr>
//   <tr>
//     <td align="center" valign="top" style="padding: 10px;">
//       <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
//         <tr>
//           <td align="left" valign="top" style="padding: 10px;">
//             <div class="highlight" style="background-color: #ffcc00; padding: 10px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 20px; font-weight: bold; color: #333333;">
//               Você recebeu 5.000 ElosCoins ao se cadastrar!
//             </div>
//           </td>
//         </tr>
//       </table>
//     </td>
//   </tr>
//   <tr>
//     <td align="center" valign="top" style="padding: 10px;">
//       <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
//         <tr>
//           <td align="left" valign="top" style="padding: 10px;">
//             <p style="margin: 0;"><strong>Próximos passos:</strong></p>
//             <table width="100%" border="0" cellspacing="0" cellpadding="0">
//               <tr>
//                 <td width="20%" align="left" valign="top">
//                   <p style="margin: 0; font-size: 18px;"><strong>&#10112; Complete seu Perfil</strong></p>
//                   <p style="margin: 0; font-size: 16px;">Adicione informações e uma foto de perfil</p>
//                 </td>
//               </tr>
//               <tr>
//                 <td width="20%" align="left" valign="top">
//                   <p style="margin: 0; font-size: 18px;"><strong>&#10113; Realize postagens</strong></p>
//                   <p style="margin: 0; font-size: 16px;">Compartilhe novidades com seus amigos</p>
//                 </td>
//               </tr>
//               <tr>
//                 <td width="20%" align="left" valign="top">
//                   <p style="margin: 0; font-size: 18px;"><strong>&#10114; Crie, participe e gerencie caixinhas</strong></p>
//                   <p style="margin: 0; font-size: 16px;">Administre suas caixinhas de forma eficiente</p>
//                 </td>
//               </tr>
//               <tr>
//                 <td width="20%" align="left" valign="top">
//                   <p style="margin: 0; font-size: 18px;"><strong>&#10115; Adicione formas de pagamento e recebimento</strong></p>
//                   <p style="margin: 0; font-size: 16px;">Configure métodos de pagamento e recebimento</p>
//                 </td>
//               </tr>
//               <tr>
//                 <td width="20%" align="left" valign="top">
//                   <p style="margin: 0; font-size: 18px;"><strong>&#10120; Convide seus amigos</strong></p>
//                   <p style="margin: 0; font-size: 16px;">Traga seus amigos para a ElosCloud</p>
//                 </td>
//               </tr>
//             </table>
//           </td>
//         </tr>
//       </table>
//     </td>
//   </tr>
//   <tr>
//     <td align="center" valign="top" style="padding: 10px;">
//       <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
//         Clique no botão abaixo para acessar sua conta!
//       </p>
//       <a href="${BASE_URL}/login" style="display: block; width: 200px; margin: 20px auto; padding: 10px; background-color: #007bff; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-size: 16px;">
//         VALIDAR MINHA CONTA E ENTRAR
//       </a>
//     </td>
//   </tr>
// </table>
//   `;

//   try {
//     // Usar a função global de envio de email
//     await emailService.sendEmail({
//       to: email,
//       subject: 'ElosCloud - Boas-vindas!',
//       content: welcomeContent,
//       type: 'padrao'
//     });
    
//     logger.info('Email de boas-vindas enviado com sucesso', {
//       service: 'inviteService',
//       function: 'sendWelcomeEmail',
//       email
//     });
//   } catch (error) {
//     logger.error('Erro ao enviar email de boas-vindas', {
//       service: 'inviteService',
//       function: 'sendWelcomeEmail',
//       email,
//       error: error.message
//     });
//     // Não lançar erro para não interromper o fluxo principal
//   }
// };

module.exports = {
  checkInvite,
  validateInvite, 
  invalidateInvite,
  generateAndSendInvite,
  resendInvite,
  getSentInvites,
  cancelInvite,
  canSendInvite,
  getInviteById,
  // prepareInviteEmailContent,
  // prepareReminderEmailContent,
  // sendWelcomeEmail
};