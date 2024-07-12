const { admin, db } = require('../firebaseAdmin');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService')
const User = require('../models/User');
const Invite = require('../models/Invite');
const Notification = require('../models/Notification');
const crypto = require('crypto');
const {logger} = require('../logger');
const QRCode = require('qrcode');

exports.getInviteById = async (id) => {
  try {
    return await Invite.getById(id);
  } catch (error) {
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
  const userId = req.uid;
  logger.info('Iniciando verificação se pode enviar convite', { service: 'inviteService', function: 'canSendInvite', userId });

  try {
    const user = await getUserById(userId);
    if (!user) {
      logger.warn('Usuário não encontrado', { service: 'inviteService', function: 'canSendInvite', userId });
      throw new Error('User not found');
    }
    
    const userPlainObject = user.toPlainObject();
    logger.info('Usuário encontrado', { service: 'inviteService', function: 'canSendInvite', user: userPlainObject });

    const invitesSnapshot = await db.collection('convites')
      .where('userId', '==', userPlainObject.uid)
      .get();

    const canSend = invitesSnapshot.empty;
    logger.info('Verificação de envio de convite concluída', { service: 'inviteService', function: 'canSendInvite', userId, canSend });
    return { canSend, user: userPlainObject };
  } catch (error) {
    logger.error('Erro na verificação se pode enviar convite', { service: 'inviteService', function: 'canSendInvite', userId, error: error.message });
    return { canSend: false, message: `Error in canSendInvite: ${error.message}` };
  }
};

exports.generateInvite = async (req) => {
  const inviteData = await req;
  const userId = req.userId; 
  const friendFoto = process.env.CLAUD_PROFILE_IMG;
  const inviteId = uuidv4();
  const { email, friendName } = inviteData;
  const type = 'convite';
  const conteudo = `O convite foi enviado com sucesso para ${friendName}`;
  const url = `https://eloscloud.com`;
  let senderName, senderPhotoURL;
  
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
          url: `https://eloscloud.com.br/invite?inviteId=${inviteId}`,
        }
      };

      transaction.set(mailRef, mailData);
      logger.info('Dados de email criados', { service: 'inviteService', function: 'generateInvite', mailData });
    });

    const qrCodeBuffer = await QRCode.toBuffer(`https://eloscloud.com/invite?inviteId=${inviteId}`);
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
              <p style="margin: 0;">${senderName}</p>
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
              <p style="margin: 0;">${friendName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="text-align: center;">
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
          Validade: 5 Dias para Fazer Check-in!
        </div>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <a href="https://eloscloud.com/invite?inviteId=${inviteId}" class="button">
          Aceitar Convite
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <img src="cid:qr_code.png" alt="QR Code" width="150" height="150" style="display: block; margin: auto;" />
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <p style="text-align: center; font-size: 16px; color: #333;">
          Clique no botão ou escaneie o QR code para validar o seu convite e se registrar!
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
          contentType: 'image/png',
          content: qrCodeBuffer.toString('base64'),
          cid: 'qr_code.png',
          encoding: 'base64'
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

exports.validateInvite = async (inviteId, userEmail) => {
  try {
    const db = admin.firestore();
    const inviteRef = db.collection('convites').doc(inviteId);

    await db.runTransaction(async (transaction) => {
      const inviteDoc = await transaction.get(inviteRef);

      if (!inviteDoc.exists || inviteDoc.data().status !== 'pending' || inviteDoc.data().email !== userEmail) {
        throw new Error('Invalid or already used invite.');
      }

      const inviteData = inviteDoc.data();
      const expiresAt = inviteData.expiresAt;

      if (expiresAt && expiresAt < Date.now()) {
        throw new Error('Invite has expired.');
      }

      transaction.update(inviteRef, { validatedBy: userEmail, status: 'used' });
    });

    return { success: true };
  } catch (error) {
    console.error('Erro ao validar convite:', error);
    throw new Error('Erro ao validar convite.');
  }
};

exports.invalidateInvite = async (inviteId, newUserId) => {
  try {
    await firestore.runTransaction(async (transaction) => {
      const inviteRef = firestore.collection('convites').doc(inviteId);
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
        <p>Olá!</p>
        <p>Sua conta foi criada com sucesso.</p>
        <p><strong>Bem-vindo à ElosCloud!</strong></p>
        <div class="email-highlight">
        Você recebeu 5.000 ElosCoins ao se cadastrar!
        </div>
        <p>Próximos passos:</p>
        <ol>
          <li>Complete seu Perfil</li>
          <li>Realize postagens</li>
          <li>Crie, participe e gerencie caixinhas</li>
          <li>Adicione formas de pagamento e recebimento</li>
          <li>Efetue o pagamento da mensalidade das caixinhas</li>
          <li>Use PIX, cartões de crédito ou débito</li>
          <li>Envie e receba presentes</li>
          <li>Comprar eloscoin</li>
          <li>Convide seus amigos</li>
        </ol>
        <p>Aproveite! Seus ElosCoins já estão disponíveis na sua conta.</p>
        <p>Obrigado,</p>
        <p>Equipe ElosCloud</p>
        <p style="text-align: center; font-size: 16px; color: #333;">
          Clique no botão abaixo para acessar sua conta!
        </p>
        <a href="https://eloscloud.com/login" class="boarding-pass__button">
          Acessar Minha Conta
        </a>
      `;

      const newUserRef = firestore.collection('usuario').doc(newUserId);
      const comprasRef = newUserRef.collection('compras');
      const ancestralidadeRef = newUserRef.collection('ancestralidade');

      transaction.set(comprasRef.doc(), {
        quantidade: 5000,
        valorPago: 0,
        dataCompra: admin.firestore.FieldValue.serverTimestamp(),
        meioPagamento: 'oferta-boas-vindas'
      });

      transaction.set(ancestralidadeRef.doc(), {
        inviteId: inviteId,
        senderId: inviteData.senderId,
        dataAceite: admin.firestore.FieldValue.serverTimestamp(),
        fotoDoUsuario: inviteData.senderPhotoURL
      });

      const senderRef = firestore.collection('usuario').doc(inviteData.senderId);
      const descendentesRef = senderRef.collection('descendentes');

      transaction.set(descendentesRef.doc(), {
        userId: newUserId,
        nome: inviteData.senderName,
        email: inviteData.email,
        fotoDoPerfil: inviteData.senderPhotoURL,
        dataAceite: admin.firestore.FieldValue.serverTimestamp()
      });

      transaction.set(firestore.collection('mail').doc(), {
        to: [{ email: inviteData.email }],
        subject: 'ElosCloud - Boas-vindas!',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
