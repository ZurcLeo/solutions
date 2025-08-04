/**
 * @fileoverview Serviço para gerenciar o ciclo de vida dos convites de usuários, incluindo criação, validação, envio, reenvio e cancelamento.
 * @module services/inviteService
 * @requires uuid
 * @requires crypto
 * @requires jsonwebtoken
 * @requires qrcode
 * @requires moment
 * @requires ../logger
 * @requires ../models/Invite
 * @requires ../models/User
 * @requires ./emailService
 * @requires ./notificationService
 * @requires ../utils/errors
 * @requires firebaseAdmin
 */
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
 * Verifica a existência, o status e a validade temporal de um convite.
 * @async
 * @function checkInvite
 * @param {string} inviteId - O ID do convite a ser verificado.
 * @param {string} [email=null] - Email opcional para verificação adicional, garantindo que o convite seja para o email correto.
 * @returns {Promise<Object>} Um objeto contendo `valid` (booleano) e uma `message` detalhando o status. Se válido, inclui um objeto `invite` com dados formatados.
 * @throws {HttpError} Se ocorrer um erro inesperado durante a verificação.
 * @description Confere se um convite existe, está pendente, não expirou e, opcionalmente, corresponde a um email específico.
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
 * Valida um convite com email e nome fornecidos para iniciar o processo de registro de um novo usuário.
 * @async
 * @function validateInvite
 * @param {string} inviteId - O ID do convite a ser validado.
 * @param {string} email - O endereço de e-mail do convidado.
 * @param {string} nome - O nome do convidado.
 * @returns {Promise<Object>} Um objeto com `inviteId`, informações do remetente (`inviter`) e um `registrationToken` temporário.
 * @throws {HttpError} Se o convite for inválido, não corresponder aos dados fornecidos, ou ocorrer um erro.
 * @description Além de verificar a validade do convite, também confirma o nome do convidado, atualiza o status do convite para 'validated' e gera um token JWT para prosseguir com o registro.
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
 * Invalida um convite após seu uso completo durante o processo de registro de um novo usuário.
 * @async
 * @function invalidateInvite
 * @param {string} inviteId - O ID do convite a ser invalidado.
 * @param {string} newUserId - O ID do novo usuário que foi registrado usando este convite.
 * @returns {Promise<Object>} Um objeto com `success: true` se a operação for bem-sucedida.
 * @throws {HttpError} Se o convite não for encontrado, já tiver sido utilizado, ou ocorrer um erro na transação.
 * @description Marca o convite como 'used', estabelece o relacionamento de ancestralidade e descendência entre os usuários, concede moedas de boas-vindas ao novo usuário e envia notificações.
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
 * Verifica se um usuário pode enviar um convite para um determinado endereço de e-mail, considerando limites e convites existentes.
 * @async
 * @function canSendInvite
 * @param {string} userId - O ID do usuário remetente.
 * @param {string} email - O endereço de e-mail do destinatário proposto.
 * @returns {Promise<Object>} Um objeto contendo `canSend` (booleano), uma `message` (se não puder enviar) e o objeto `user` do remetente, ou `existingInvite` se houver um convite pendente/reaproveitável.
 * @throws {HttpError} Se o usuário remetente não for encontrado ou ocorrer um erro.
 * @description Avalia diversas condições para permitir ou negar o envio de um novo convite ou o reenvio de um existente, como limites de convites pendentes, status de convites anteriores para o mesmo email e cooldown para reenvios.
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
 * Gera um novo convite, o envia por e-mail e cria uma notificação para o remetente.
 * @async
 * @function generateAndSendInvite
 * @param {string} userId - O ID do usuário que está enviando o convite.
 * @param {string} email - O endereço de e-mail do destinatário.
 * @param {string} friendName - O nome do destinatário.
 * @returns {Promise<Object>} Um objeto com `inviteId`, `email`, `friendName` e `expiresAt` formatada.
 * @throws {HttpError} Se o envio não for permitido, ou ocorrer um erro na criação/envio.
 * @description Utiliza `canSendInvite` para verificar permissões. Se um convite pendente já existir, ele o reenvia; caso contrário, cria um novo convite, gera um QR Code, envia um e-mail com template e notifica o remetente.
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
 * Reenvia um convite existente que ainda está pendente.
 * @async
 * @function resendInvite
 * @param {string} inviteId - O ID do convite a ser reenviado.
 * @param {string} userId - O ID do usuário que está solicitando o reenvio (deve ser o remetente original).
 * @returns {Promise<Object>} Um objeto com `inviteId`, `email`, `friendName` e `resendCount` atualizado.
 * @throws {HttpError} Se o convite não for encontrado, o usuário não tiver permissão, o convite não estiver pendente ou o cooldown de reenvio não tiver sido respeitado.
 * @description Atualiza o contador de reenvios do convite, envia um novo e-mail (lembrete) e cria uma notificação para o remetente.
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
 * Recupera todos os convites enviados por um usuário, com status e metadados adicionais.
 * @async
 * @function getSentInvites
 * @param {string} userId - O ID do usuário remetente.
 * @returns {Promise<Array<Object>>} Uma lista de objetos de convite enviados, incluindo `expiresAt`, `timeRemaining`, `statusDisplay` e `canResend`.
 * @throws {HttpError} Se o ID do usuário for obrigatório e não fornecido, ou ocorrer um erro na busca.
 * @description Busca convites pelo ID do remetente e adiciona informações calculadas como prazo de expiração e possibilidade de reenvio.
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
 * Cancela um convite que ainda não foi utilizado (status 'pending').
 * @async
 * @function cancelInvite
 * @param {string} inviteId - O ID do convite a ser cancelado.
 * @param {string} userId - O ID do usuário que está solicitando o cancelamento (deve ser o remetente original).
 * @returns {Promise<Object>} Um objeto com `success: true` se a operação for bem-sucedida.
 * @throws {HttpError} Se o convite não for encontrado, o usuário não tiver permissão, ou o convite não estiver no status 'pending'.
 * @description Altera o status do convite para 'canceled', impedindo seu uso futuro.
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
 * Obtém os detalhes completos de um convite específico.
 * @async
 * @function getInviteById
 * @param {string} inviteId - O ID do convite a ser detalhado.
 * @returns {Promise<Object>} Um objeto contendo todos os detalhes do convite, com datas formatadas e tempo restante.
 * @throws {HttpError} Se o convite não for encontrado ou ocorrer um erro na busca.
 * @description Recupera um convite pelo seu ID e formata suas informações para exibição.
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
 * Gera um JSON Web Token (JWT) temporário para o processo de registro.
 * @private
 * @function generateRegistrationToken
 * @param {string} inviteId - O ID do convite associado.
 * @param {string} email - O email do convidado.
 * @returns {string} O token JWT assinado.
 * @description Cria um token que será usado para validar o fluxo de registro após a validação inicial do convite.
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


module.exports = {
  checkInvite,
  validateInvite, 
  invalidateInvite,
  generateAndSendInvite,
  resendInvite,
  getSentInvites,
  cancelInvite,
  canSendInvite,
  getInviteById
};