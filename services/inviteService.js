const { admin, getFirestore } = require('../firebaseAdmin');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService')
const User = require('../models/User');
const Invite = require('../models/Invite');
const Notification = require('../models/Notification');
const crypto = require('crypto');
const {logger} = require('../logger');
const QRCode = require('qrcode');
const moment = require('moment');

const logoURL = process.env.PLACE_HOLDER_IMG;

exports.getInviteById = async (inviteId) => {
  
  logger.info(`Iniciando a busca pelo convite ${inviteId}`, {
    service: 'inviteService',
    function: 'getInviteById',
    inviteId,
  });

  try {
    const invite = await Invite.getById(inviteId);

    logger.info(`Convite ${inviteId} encontrado com sucesso`, {
      service: 'inviteService',
      function: 'getInviteById',
      inviteId,
      inviteData: invite
    });

    return invite;
  } catch (error) {
    logger.error(`Erro ao buscar o convite ${inviteId}`, {
      service: 'inviteService',
      function: 'getInviteById',
      inviteId,
      error: error.message
    });

    throw new Error('Invite not found');
  }
};

exports.createInvite = async (data) => {
  try {
    const { error } = inviteSchema.validate(data);
    if (error) {
      return { status: 400, message: `Invalid invite data: ${error.message}` };
    }
    return await Invite.create(data);
  } catch (error) {
    return { status: 500, message: 'Failed to create invite' };
  }
};

exports.updateInvite = async (id, data) => {
  try {
    return await Invite.update(id, data);
  } catch (error) {
    throw new Error('Failed to update invite');
  }
};

exports.getSentInvites = async (userId) => {
  console.log('Fetching sent invites for user:', userId);
  if (!userId) {
    throw new Error('User ID is required to get sent invites.');
  }
  try {
    const invites = await Invite.getBySenderId(userId);
    invites.forEach(invite => {
      if (invite.status === 'pending' && moment(invite.createdAt).isBefore(moment().subtract(5, 'days'))) {
        invite.status = 'expired';
      }
    });
    return invites;
  } catch (error) {
    console.error('Error fetching sent invites:', error);
    throw new Error('Erro ao buscar convites enviados.');
  }
};

exports.cancelInvite = async (inviteId) => {
  console.log('Fetching sent invites for user:', userId);
  if (!inviteId) {
    throw new Error('Código de convite - inviteID - é obrigatório para esta requisição.');
  }
  try {
    const invite = await Invite.update(inviteId, { status: 'cancelado' });
    res.status(200).json(invite);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cancelar convite.', error: error.message });
  }
};

exports.deleteInvite = async (id) => {
  try {
    await Invite.delete(id);
  } catch (error) {
    throw new Error('Failed to delete invite');
  }
};

exports.canSendInvite = async (req) => {
  const db = getFirestore(); // Garante a inicialização do Firestore
  const userId = req.uid;
  const email = req.body.email; // Supondo que o email seja enviado no corpo da requisição
  logger.info('Iniciando verificação se pode enviar convite', { service: 'inviteService', function: 'canSendInvite', userId, email });

  try {
    const user = await getUserById(userId);
    if (!user) {
      logger.warn('Usuário não encontrado', { service: 'inviteService', function: 'canSendInvite', userId });
      throw new Error('User not found');
    }

    const userPlainObject = user.toPlainObject();
    logger.info('Usuário encontrado', { service: 'inviteService', function: 'canSendInvite', user: userPlainObject });

    const invitesSnapshot = await db.collection('convites')
      .where('email', '==', email)
      .orderBy('createdAt', 'desc') // Ordena por data de criação para pegar o último convite
      .limit(1)
      .get();

    if (invitesSnapshot.empty) {
      logger.info('Nenhum convite encontrado para o email', { service: 'inviteService', function: 'canSendInvite', email });
      return { canSend: true, user: userPlainObject };
    }

    const invite = invitesSnapshot.docs[0].data();
    const now = new Date();

    // Verifica o estado do convite
    if (invite.status === 'canceled' || invite.status === 'used') {
      logger.info('Convite já cancelado ou utilizado. Não pode reenviar.', { service: 'inviteService', function: 'canSendInvite', invite });
      return { canSend: false, message: `Convite já ${invite.status}. Não pode ser reenviado.` };
    }

    // Verifica se o convite expirou
    if (invite.status === 'expired') {
      logger.info('Convite expirado. Pode ser reenviado.', { service: 'inviteService', function: 'canSendInvite', invite });
      return { canSend: true, user: userPlainObject };
    }

    // Verifica se pode reenviar (1 hora após o último envio)
    const lastSentAt = invite.lastSentAt.toDate();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    if (lastSentAt > oneHourAgo) {
      logger.info('Convite foi enviado há menos de 1 hora. Não pode ser reenviado ainda.', { service: 'inviteService', function: 'canSendInvite', invite });
      return { canSend: false, message: 'Convite foi enviado há menos de 1 hora. Aguarde para reenviar.' };
    }

    logger.info('Convite pode ser reenviado.', { service: 'inviteService', function: 'canSendInvite', invite });
    return { canSend: true, user: userPlainObject };
  } catch (error) {
    logger.error('Erro na verificação se pode enviar convite', { service: 'inviteService', function: 'canSendInvite', userId, error: error.message });
    return { canSend: false, message: `Error in canSendInvite: ${error.message}` };
  }
};

exports.generateInvite = async (req) => {
  const db = await getFirestore(); // Garante a inicialização do Firestore
  const inviteData = await req;
  const userId = req.userId; 
  const friendFoto = process.env.CLAUD_PROFILE_IMG;
  const inviteId = uuidv4();
  const { email, friendName } = inviteData;
  const type = 'convite';
  const conteudo = `O convite foi enviado com sucesso para ${friendName}`;
  const url = `https://eloscloud.com`;
  let senderName, senderPhotoURL;
  
  const baseUrl = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:3000'
  : 'https://eloscloud.com';
  
  logger.info('inviteData no generateInvite:', { service: 'inviteService', function: 'generateInvite', inviteData });

  try {
    const sender = await User.getById(userId);
    senderName = sender.nome;
    senderPhotoURL = sender.fotoDoPerfil;

    if (!senderName || !senderPhotoURL) {
      throw new Error('Por favor, preencha seu nome e foto de perfil para continuar.');
    }
  } catch (error) {
    logger.error('Erro ao buscar usuário', { service: 'inviteService', function: 'generateInvite', error: error.message });
    throw new Error('Erro ao buscar usuário.');
  }

  try {
    const inviteRef = db.collection('convites').doc();
    const mailRef = db.collection('mail').doc();

    await db.runTransaction(async (transaction) => {
      const createdAt = admin.firestore.FieldValue.serverTimestamp();
      const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));

      const inviteDataMail = {
        email,
        senderId: userId,
        friendName,
        senderName,
        inviteId,
        createdAt,
        senderPhotoURL,
        status: 'pending',
        expiresAt
      };

      logger.info('Salvando convite com os seguintes dados:', { inviteDataMail });

      transaction.set(inviteRef, inviteDataMail, { merge: true });
      logger.info('Convite criado', { service: 'inviteService', function: 'generateInvite', inviteData: inviteDataMail });

      const mailData = {
        to: email,
        subject: '[ElosCloud] Bilhete de Embarque',
        createdAt,
        expiresAt,
        status: 'pending',
        data: {
          inviteId,
          senderId: userId,
          friendName,
          url: `${baseUrl}/invite/validate/${inviteId}`,
        }
      };

      logger.info('Salvando email com os seguintes dados:', { mailData });
      transaction.set(mailRef, mailData);
      logger.info('Dados de email criados', { service: 'inviteService', function: 'generateInvite', mailData });
    });

    const qrCodeBuffer = await QRCode.toDataURL(`${baseUrl}/invite/validate/${inviteId}`);
    console.log(qrCodeBuffer)
    const hashedInviteId = crypto.createHash('sha256').update(inviteId).digest('hex');
    const maskedHashedInviteId = hashedInviteId.substring(0, 4) + '******' + hashedInviteId.substring(hashedInviteId.length - 4);

    const content = 
    `
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
          <tr>
            <td align="left" valign="top" style="padding: 10px;">
              <img src="${senderPhotoURL}" alt="${senderName}" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
            </td>
            <td align="left" valign="top">
              <p style="margin: 0;"><strong>Enviado Por:</strong></p>
              <p style="margin: 0; font-size: 20px;">${senderName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
          <tr>
            <td align="left" valign="top" style="padding: 10px;">
              <img src="${friendFoto}" alt="${friendName}" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
            </td>
            <td align="left" valign="top">
              <p style="margin: 0;"><strong>Convite para:</strong></p>
              <p style="margin: 0; font-size: 20px;">${friendName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; color: rgba(0, 0, 255, 0.5)">
          <tr>
            <td>
              <p><strong>DESTINO:</strong> ELOSAPP</p>
              <p><strong>PASSAGEIRO:</strong> ${friendName}</p>
              <p><strong>CREDENCIAL:</strong> ${maskedHashedInviteId}</p>
              <p><strong>GERADO EM:</strong> ${new Date().toLocaleDateString()}</p>
              <p><strong>EXPIRA EM:</strong> ${new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString()}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
     <tr>
<td align="center" valign="top" style="padding: 10px;">
     
        <div class="highlight">
         Instruções
        </div>
    
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
  <tr>
    <td align="left" valign="top" style="padding: 10px;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10112; Aceitar</strong></p>
            <p style="margin: 0; font-size: 16px;">Clique no botão Aceitar Convite</p>
          </td>
        </tr>
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10113; Validar E-mail</strong></p>
            <p style="margin: 0; font-size: 16px;">Informe o e-mail que você recebeu o convite</p>
          </td>
        </tr>
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10114; Validar Nome</strong></p>
            <p style="margin: 0; font-size: 16px;">Informe o seu nome exatamente como neste convite</p>
          </td>
        </tr>
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10115; Validar Convite</strong></p>
            <p style="margin: 0; font-size: 16px;">Clique no botão Validar Convite</p>
          </td>
        </tr>
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10116; Registrar</strong></p>
            <p style="margin: 0; font-size: 16px;">Na pagina de registro escolha sua forma preferida</p>
          </td>
        </tr>
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10117; Confirmar Registro</strong></p>
            <p style="margin: 0; font-size: 16px;">Clique no botão Criar Conta</p>
          </td>
        </tr>
        <tr>
          <td width="20%" align="left" valign="top">
            <p style="margin: 0; font-size: 18px;"><strong>&#10118; Boas-vindas</strong></p>
            <p style="margin: 0; font-size: 16px;">Parabéns! Um e-mail de boas-vindas será enviado</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
      <a href="${baseUrl}/invite/validate/${inviteId}" class="button">
          Aceitar Convite
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <img src="${qrCodeBuffer}" alt="QR Code" width="150" height="150" style="display: block; margin: auto;" />
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
          Clique no botão ou escaneie o QRCode para validar o seu convite e se registrar!
        </p>
        <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
    Não se interessou? Sem problemas, basta ignorar este e-mail.
        </p>
      </td>
    </tr>
    
  </table>
`;

    const emailData = {
      to: email,
      subject: '[ElosCloud] Bilhete de Embarque',
      content,
      userId,
      friendName,
      inviteId,
      type,
      attachments: [
        {
          filename: 'qr_code.png',
          content: qrCodeBuffer.split("base64,")[1],
          encoding: 'base64',
          cid: 'qrCode'
        },
      ],
    };

    logger.info('Conteúdo do email gerado', { service: 'inviteService', function: 'generateInvite', emailData });

    await sendEmail(emailData);

    const notify = await Notification.create(userId, type, conteudo, url);

    logger.info('Notificação criada com sucesso', {
      service: 'inviteService',
      function: 'generateInvite',
      notification: notify
    });

    return { success: true };

  } catch (error) {
    logger.error('Erro ao criar convite', { service: 'inviteService', function: 'generateInvite', error: error.message });
    throw new Error('Erro ao criar convite');
  }
};

exports.validateInvite = async (inviteId, email, nome) => {
  const db = getFirestore(); // Garante a inicialização do Firestore
  try {
    const { invite, inviteRef } = await Invite.getById(inviteId);

    logger.info('Dados do convite recuperados do Firestore:', { invite });

    await db.runTransaction(async (transaction) => {
      logger.info(`Iniciando transação para validar o convite ${inviteId}`, {
        service: 'inviteService',
        function: 'validateInvite',
        inviteId,
        email,
        nome
      });

      const inviteDoc = await transaction.get(inviteRef);

      if (!inviteDoc.exists) {
        logger.error(`Convite ${inviteId} não encontrado`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome
        });
        throw new Error('[invalid-data]Convite inválido.');
      }
      
      const inviteData = inviteDoc.data();

      if (inviteData.status !== 'pending') {
        logger.error(`Convite ${inviteId} não está pendente`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome,
          status: inviteData.status
        });
        throw new Error('[invalid-status]Convite inválido.');
      }
      
      if (inviteData.email !== email) {
        logger.error(`E-mail ${email} não confere para o convite ${inviteId}`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome,
          inviteEmail: inviteData.email
        });
        throw new Error('[invalid-email] E-mail não confere.');
      }
      
      if (inviteData.friendName.trim().toLowerCase() !== nome.trim().toLowerCase()) {
        logger.error(`Nome ${nome} não confere para o convite ${inviteId}`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome,
          inviteNome: inviteData.friendName
        });
        throw new Error('[invalid-name]O nome não confere.');
      }
      
      const expiresAt = inviteData.expiresAt;

      if (expiresAt && expiresAt.toMillis() < Date.now()) {
        logger.error(`Convite ${inviteId} expirou em ${expiresAt.toDate()}`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome,
          expiresAt: expiresAt.toDate()
        });
        throw new Error('[invalid-expired]Convite expirado.');
      }

      logger.info('Comparando validade do convite:', {
        expiresAtMillis: expiresAt.toMillis(),
        currentMillis: Date.now(),
        expiresAtDate: expiresAt.toDate(),
        currentDate: new Date()
      });
      

      logger.info('Comparando os nomes:', {
        nomeInformado: nome,
        nomeArmazenado: inviteData.friendName,
        nomeInformadoNormalizado: nome.trim().toLowerCase(),
        nomeArmazenadoNormalizado: inviteData.friendName.trim().toLowerCase()
      });
      

      logger.info(`Validando convite ${inviteId} para o e-mail ${email}`, {
        service: 'inviteService',
        function: 'validateInvite',
        inviteId,
        email,
        nome
      });

      transaction.update(inviteRef, 
        { 
          validatedBy: email, 
          status: 'used',
          nome: nome,
          validatedAt: admin.firestore.FieldValue.serverTimestamp()
         });

      logger.info(`Convite ${inviteId} validado com sucesso`, {
        service: 'inviteService',
        function: 'validateInvite',
        inviteId,
        email,
        nome
      });
    });

    return { success: true };
  } catch (error) {
    logger.error('Erro ao validar convite:', {
      service: 'inviteService',
      function: 'validateInvite',
      inviteId,
      email,
      nome,
      error: error.message
    });
    throw new Error('Erro ao validar convite.');
  }
};

exports.resendInvite = async (inviteId, userId) => {
  const db = getFirestore(); // Garante a inicialização do Firestore

  logger.info('Reenviando convite', { service: 'inviteService', function: 'resendInvite', inviteId, userId });

  try {

    const { inviteRef, invite } = await Invite.getById(inviteId);

    logger.info(`Convite ${inviteId} encontrado com sucesso`, {
      service: 'inviteService',
      function: 'getInviteById',
      inviteId,
      inviteRef
    });

    return await db.runTransaction(async (transaction) => {
      const inviteDoc = await transaction.get(inviteRef);
      
      if (!inviteDoc.exists) {
        logger.error('Convite não encontrado', { service: 'inviteService', function: 'resendInvite', inviteId });
        throw new Error('Convite não encontrado');
      }
      
      const inviteData = inviteDoc.data();
      
      if (inviteData.senderId !== userId) {
        logger.error('Usuário não autorizado a reenviar este convite', { service: 'inviteService', function: 'resendInvite', inviteId, userId });
        throw new Error('Usuário não autorizado a reenviar este convite');
      }
      
      if (inviteData.status !== 'pending') {
        logger.error('Convite não pode ser reenviado', { service: 'inviteService', function: 'resendInvite', inviteId, status: inviteData.status });
        throw new Error('Convite não pode ser reenviado');
      }
      
      const now = admin.firestore.Timestamp.fromDate(new Date(Date.now()))
      const oneHourAgo = new admin.firestore.Timestamp(now.seconds - 3600, now.nanoseconds);
      
      if (inviteData.lastSentAt && inviteData.lastSentAt > oneHourAgo) {
        logger.error('Convite foi reenviado recentemente', { service: 'inviteService', function: 'resendInvite', inviteId, lastSentAt: inviteData.lastSentAt });
        throw new Error('Convite foi reenviado recentemente. Aguarde uma hora antes de reenviar.');
      }
      
      //Update the invite document
      transaction.update(inviteRef, { 
        lastSentAt: now,
        resendCount: admin.firestore.FieldValue.increment(1)
      });
      
      // Resend the email
      await sendEmail({
        to: inviteData.email,
        subject: '[ElosCloud] Lembrete de Convite',
        content: `Olá ${inviteData.friendName}, este é um lembrete do seu convite para se juntar ao ElosCloud. Clique no link abaixo para aceitar o convite: https://eloscloud.com/invite?inviteId=${inviteId}`,
        userId: userId,
        friendName: inviteData.friendName,
        inviteId: inviteId,
        type: 'convite_lembrete'
      });
      
      logger.info('Convite reenviado com sucesso', { service: 'inviteService', function: 'resendInvite', inviteId });
      return { success: true, message: 'Convite reenviado com sucesso' };
    });
  } catch (error) {
    logger.error('Erro ao reenviar convite', { service: 'inviteService', function: 'resendInvite', inviteId, error: error.message });
    throw new Error(`Erro ao reenviar convite: ${error.message}`);
  }
};

exports.invalidateInvite = async (inviteId, newUserId) => {
  const db = getFirestore(); // Garante a inicialização do Firestore
  try {
    await db.runTransaction(async (transaction) => {
      const inviteRef = db.collection('convites').doc(inviteId);
      const inviteDoc = await transaction.get(inviteRef);

      if (!inviteDoc.exists) {
        throw new Error('Invite not found.');
      }

      const inviteData = inviteDoc.data();

      if (inviteData.status === 'used') {
        throw new Error('Invite already used.');
      }

      transaction.update(inviteRef, { status: 'used' });

      const welcomeContent = `
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td align="center" valign="top" style="padding: 10px;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
        <tr>
          <td align="left" valign="top" style="padding: 10px;">
            <img src="${logoURL}" alt="ElosCloud" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
          </td>
          <td align="left" valign="top">
            <p style="margin: 0;"><strong>Bem-vindo à ElosCloud!</strong></p>
            <p style="margin: 0; font-size: 20px;">Sua conta foi criada com sucesso.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" style="padding: 10px;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
        <tr>
          <td align="left" valign="top" style="padding: 10px;">
            <div class="highlight">
              Você recebeu 5.000 ElosCoins ao se cadastrar!
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" style="padding: 10px;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
        <tr>
          <td align="left" valign="top" style="padding: 10px;">
            <p style="margin: 0;"><strong>Próximos passos:</strong></p>
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10112; Complete seu Perfil</strong></p>
                  <p style="margin: 0; font-size: 16px;">Adicione informações e uma foto de perfil</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10113; Realize postagens</strong></p>
                  <p style="margin: 0; font-size: 16px;">Compartilhe novidades com seus amigos</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10114; Crie, participe e gerencie caixinhas</strong></p>
                  <p style="margin: 0; font-size: 16px;">Administre suas caixinhas de forma eficiente</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10115; Adicione formas de pagamento e recebimento</strong></p>
                  <p style="margin: 0; font-size: 16px;">Configure métodos de pagamento e recebimento</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10116; Efetue o pagamento da mensalidade das caixinhas</strong></p>
                  <p style="margin: 0; font-size: 16px;">Mantenha suas caixinhas ativas e organizadas</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10117; Use PIX, cartões de crédito ou débito</strong></p>
                  <p style="margin: 0; font-size: 16px;">Pague e receba com seus métodos preferidos</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10118; Envie e receba presentes</strong></p>
                  <p style="margin: 0; font-size: 16px;">Surpreenda seus amigos com presentes</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10119; Compre ElosCoins</strong></p>
                  <p style="margin: 0; font-size: 16px;">Adquira mais ElosCoins para usar na plataforma</p>
                </td>
              </tr>
              <tr>
                <td width="20%" align="left" valign="top">
                  <p style="margin: 0; font-size: 18px;"><strong>&#10120; Convide seus amigos</strong></p>
                  <p style="margin: 0; font-size: 16px;">Traga seus amigos para a ElosCloud</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" style="padding: 10px;">
      <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
        Clique no botão abaixo para acessar sua conta!
      </p>
      <a href="https://eloscloud.com/login" class="button" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        VALIDAR MINHA CONTA E ENTRAR
      </a>
    </td>
  </tr>
</table>

      `;

      const newUserRef = db.collection('usuario').doc(newUserId);
      const comprasRef = newUserRef.collection('compras');
      const ancestralidadeRef = newUserRef.collection('ancestralidade');

      transaction.set(comprasRef.doc(), {
        quantidade: 500,
        valorPago: 0,
        dataCompra: db.FieldValue.serverTimestamp(),
        meioPagamento: 'oferta-boas-vindas'
      });

      transaction.set(ancestralidadeRef.doc(), {
        inviteId: inviteId,
        senderId: inviteData.senderId,
        dataAceite: db.FieldValue.serverTimestamp(),
        fotoDoUsuario: inviteData.senderPhotoURL
      });

      const senderRef = db.collection('usuario').doc(inviteData.senderId);
      const descendentesRef = senderRef.collection('descendentes');

      transaction.set(descendentesRef.doc(), {
        userId: newUserId,
        nome: inviteData.senderName,
        email: inviteData.email,
        fotoDoPerfil: inviteData.senderPhotoURL,
        dataAceite: db.FieldValue.serverTimestamp()
      });

      transaction.set(db.collection('mail').doc(), {
        to: [{ email: inviteData.email }],
        subject: 'ElosCloud - Boas-vindas!',
        createdAt: db.FieldValue.serverTimestamp(),
        status: 'sent',
        data: {
          inviteId: inviteId,
          userId: newUserId,
          email: inviteData.email
        }
      });
      await sendEmail(inviteData.email, 'ElosCloud - Bem-vindo!', welcomeContent);
    });

    return { success: true };
  } catch (error) {
    console.error('Erro ao invalidar convite:', error);
    throw new Error('Erro ao invalidar convite.');
  }
};
