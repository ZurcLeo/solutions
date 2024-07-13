const { admin, db } = require('../firebaseAdmin');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService')
const User = require('../models/User');
const Invite = require('../models/Invite');
const Notification = require('../models/Notification');
const crypto = require('crypto');
const {logger} = require('../logger');
const QRCode = require('qrcode');

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

    const qrCodeBuffer = await QRCode.toDataURL(`https://eloscloud.com/invite?inviteId=${inviteId}`);
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
        <a href="https://eloscloud.com/invite?inviteId=${inviteId}" class="button">
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
  try {
    const { invite, inviteRef } = await Invite.getById(inviteId);

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
        throw new Error('[invalid-email]E-mail não confere.');
      }
      
      if (inviteData.nome !== nome) {
        logger.error(`Nome ${nome} não confere para o convite ${inviteId}`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome,
          inviteNome: inviteData.nome
        });
        throw new Error('[invalid-name]O nome não confere.');
      }
      
      const expiresAt = inviteData.expiresAt;

      if (expiresAt && expiresAt < Date.now()) {
        logger.error(`Convite ${inviteId} expirou em ${expiresAt}`, {
          service: 'inviteService',
          function: 'validateInvite',
          inviteId,
          email,
          nome,
          expiresAt
        });
        throw new Error('[invalid-expired]Convite expirado.');
      }

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

      const newUserRef = firestore.collection('usuario').doc(newUserId);
      const comprasRef = newUserRef.collection('compras');
      const ancestralidadeRef = newUserRef.collection('ancestralidade');

      transaction.set(comprasRef.doc(), {
        quantidade: 500,
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
