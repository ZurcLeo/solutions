const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');
const Invite = require('../models/Invite');
const { auth } = require('../firebaseAdmin');

exports.getInviteById = async (req, res) => {
  try {
    const invite = await Invite.getById(req.params.id);
    res.status(200).json(invite);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createInvite = async (req, res) => {
  try {
    const invite = await Invite.create(req.body);
    res.status(201).json(invite);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateInvite = async (req, res) => {
  try {
    const invite = await Invite.update(req.params.id, req.body);
    res.status(200).json(invite);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteInvite = async (req, res) => {
  try {
    await Invite.delete(req.params.id);
    res.status(200).json({ message: 'Convite deletado com sucesso.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.generateInvite = async (req, res) => {
  const { email } = req.body;
  const decodedToken = await auth.verifyIdToken(req.headers.authorization.split(' ')[1]);
  const senderId = decodedToken.uid;

  try {
    const userRef = admin.firestore().collection('usuario').doc(senderId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userData = userDoc.data();
    const senderName = userData.nome || null;
    const senderPhotoURL = userData.fotoDoPerfil || null;

    if (!senderName || !senderPhotoURL) {
      return res.status(400).json({
        success: false,
        redirectTo: `/PerfilPessoal/${senderId}`,
        message: 'Por favor, preencha seu nome e foto de perfil para continuar.'
      });
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
      Olá! <br>
      Você recebeu um convite. <br><br>
      Clique no botão abaixo para aceitar o convite:
      <br><br>
      <a href="https://eloscloud.com.br/invite?inviteId=${inviteId}" style="background-color: #345C72; color: #ffffff; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Aceitar Convite</a>
      <br><br>
      Obrigado, <br>
      Equipe ElosCloud
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

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao gerar convite:', error);
    return res.status(500).json({ message: 'Erro ao gerar convite.' });
  }
};

exports.validateInvite = async (req, res) => {
  const { inviteId, userEmail } = req.body;

  if (!inviteId || !userEmail) {
    return res.status(400).json({ message: 'Missing inviteId or userEmail' });
  }

  try {
    const inviteRef = admin.firestore().collection('convites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists || inviteDoc.data().status !== 'pending' || inviteDoc.data().email !== userEmail) {
      return res.status(400).json({ message: 'Invalid or already used invite.' });
    }

    await inviteRef.update({ validatedBy: userEmail, status: 'used' });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao validar convite:', error);
    return res.status(500).json({ message: 'Erro ao validar convite.' });
  }
};

exports.invalidateInvite = async (req, res) => {
  const { inviteId } = req.body;
  const newUserId = req.user.uid;

  if (!inviteId) {
    return res.status(400).json({ message: 'InviteId is required.' });
  }

  try {
    const inviteRef = admin.firestore().collection('convites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      return res.status(404).json({ message: 'Invite not found.' });
    }

    const inviteData = inviteDoc.data();

    if (inviteData.status === 'used') {
      return res.status(400).json({ message: 'Invite already used.' });
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

    console.log('Adicionando ancestralidade:', {
      inviteId: inviteId,
      senderId: inviteData.senderId,
      dataAceite: admin.firestore.FieldValue.serverTimestamp(),
      fotoDoUsuario: inviteData.senderPhotoURL
    });

    await ancestralidadeRef.add({
      inviteId: inviteId,
      senderId: inviteData.senderId,
      dataAceite: admin.firestore.FieldValue.serverTimestamp(),
      fotoDoUsuario: inviteData.senderPhotoURL
    });

    const senderRef = admin.firestore().collection('usuario').doc(inviteData.senderId);
    const descendentesRef = senderRef.collection('descendentes');

    console.log('Adicionando descendência:', {
      userId: newUserId,
      nome: inviteData.senderName,
      email: inviteData.email,
      fotoDoPerfil: inviteData.senderPhotoURL,
      dataAceite: admin.firestore.FieldValue.serverTimestamp()
    });

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

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao invalidar convite:', error);
    return res.status(500).json({ message: 'Erro ao invalidar convite.' });
  }
};
