const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('./emailService');
const { auth } = require('../firebaseAdmin');


exports.createInvite = async (email, req) => {
    const decodedToken = await auth.verifyIdToken(req.headers.authorization.split(' ')[1]);
    const senderId = decodedToken.uid;
  
    try {
      const userRef = admin.firestore().collection('usuario').doc(senderId);
      const userDoc = await userRef.get();
  
      if (!userDoc.exists) {
        return { success: false, message: 'User not found.' };
      }
  
      const userData = userDoc.data();
      senderName = userData.nome || null;
      senderPhotoURL = userData.fotoDoPerfil || null;
  
      if (!senderName ||!senderPhotoURL) {
        return {
          success: false,
          redirectTo: `/PerfilPessoal/${senderId}`,
          message: 'Por favor, preencha seu nome e foto de perfil para continuar.'
        };
      }
  
      const inviteId = uuidv4();
      const createdAt = admin.firestore.FieldValue.serverTimestamp();
  
      const inviteData = {
        email,
        senderId,
        senderName,
        inviteId,
        createdAt,
        senderPhotoURL,
        status: 'pending'
      };
  
      await admin.firestore().collection('convites').doc(inviteId).set(inviteData, { merge: true });
  
      const content = `
        <div style="text-align: center;">
          <img src="${senderPhotoURL}" alt="${senderName}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 10px;">
          <p>Convite enviado por <strong>${senderName}</strong></p>
        </div>
        <p>Olá!</p>
        <p>Você recebeu um convite para se juntar à ElosCloud, a plataforma onde você pode:</p>
        <ul>
          <li>Convidar novos amigos</li>
          <li>Realizar postagens</li>
          <li>Criar, participar e gerenciar caixinhas coletivas em grupo</li>
          <li>Adicionar formas de pagamento e recebimento</li>
          <li>Efetuar pagamento de colaboração mensal</li>
          <li>Receber proventos de caixinhas</li>
          <li>Enviar presentes usando eloscoin</li>
          <li>Comprar eloscoin</li>
          <li>Pagar com Pix ou cartão de crédito/débito</li>
        </ul>
        <p>Clique no botão abaixo para aceitar o convite e começar a explorar:</p>
        <p style="text-align: center;">
          <a href="https://eloscloud.com.br/invite?inviteId=${inviteId}" style="background-color: #345C72; color: #ffffff; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Aceitar Convite</a>
        </p>
        <p>Obrigado,</p>
        <p>Equipe ElosCloud</p>
      `;
  
      await sendEmail(email, 'ElosCloud - Seu convite chegou!', content);
  
      const mailData = {
        to: [{ email: email }],
        subject: 'Seu convite chegou!',
        createdAt: createdAt,
        status: 'pending',
        data: {
          inviteId: inviteId,
          senderId: senderId,
          url: `https://eloscloud.com.br/invite?inviteId=${inviteId}`
        }
      };
  
      await admin.firestore().collection('mail').add(mailData);
  
      return { success: true };
    } catch (error) {
      console.error(error);
      return { success: false, message: 'Erro ao criar convite.' };
    }
  };

exports.validateInvite = async (inviteId, userEmail) => {
    const inviteRef = admin.firestore().collection('convites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists || inviteDoc.data().status !== 'pending' || inviteDoc.data().email !== userEmail) {
        throw new Error('Invalid or already used invite.');
    }

    await inviteRef.update({ validatedBy: userEmail });

    return { success: true };
};

exports.invalidateInvite = async (inviteId, newUserId, context) => {
    const inviteRef = admin.firestore().collection('convites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
        throw new Error('Invite not found.');
    }

    const inviteData = inviteDoc.data();

    if (inviteData.status === 'used') {
        throw new Error('Invite already used.');
    }

    await inviteRef.update({ status: 'used' });

    const welcomeContent = `
        Olá! <br>
        Sua conta foi criada com sucesso. <br><br>
        Bem-vindo à ElosCloud! <br><br>
        Próximos passos: <br>
        -> Complete seu Perfil <br>
        -> Encontre Amigos <br>
        -> Converse em Chats Privados <br>
        -> Crie sua primeira Postagem <br>
        -> Envie e Receba Presentes <br>
        -> Realize check-in on-line no Airbnb <br>
        -> Convide seus amigos <br><br>
        Aproveite! Seus ElosCoins já estão disponíveis na sua conta<br>
        Obrigado, <br>
        Equipe ElosCloud.
    `;

    await sendEmail(inviteData.email, 'ElosCloud - Bem-vindo!', welcomeContent);

    const newUserRef = admin.firestore().collection('usuario').doc(newUserId);
    const comprasRef = newUserRef.collection('compras');
    const ancestralidadeRef = newUserRef.collection('ancestralidade');

    await comprasRef.add({
        quantidade: 5000,
        valorPago: 0,
        dataCompra: admin.firestore.FieldValue.serverTimestamp(),
        meioPagamento: 'oferta-boas-vindas'
    });

    await ancestralidadeRef.add({
        inviteId: inviteId,
        senderId: inviteData.senderId,
        dataAceite: admin.firestore.FieldValue.serverTimestamp(),
        fotoDoUsuario: inviteData.senderPhotoURL
    });

    const senderRef = admin.firestore().collection('usuario').doc(inviteData.senderId);
    const descendentesRef = senderRef.collection('descendentes');

    await descendentesRef.add({
        userId: newUserId,
        nome: inviteData.senderName,
        email: inviteData.email,
        fotoDoPerfil: inviteData.senderPhotoURL,
        dataAceite: admin.firestore.FieldValue.serverTimestamp()
    });

    await admin.firestore().collection('mail').add({
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

    return { success: true };
};
