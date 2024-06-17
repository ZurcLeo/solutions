const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');
const functions = require('firebase-functions');

exports.generateInvite = functions.https.onCall(async (data, context) => {
    const { email } = data;

    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const senderId = context.auth.uid;

    const userRef = admin.firestore().collection('usuario').doc(senderId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
    }

    const userData = userDoc.data();
    const senderName = userData.nome || null;
    const senderPhotoURL = userData.fotoDoPerfil || null;

    if (!senderName || !senderPhotoURL) {
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

    try {
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

        return { success: true };
    } catch (error) {
        console.error('Erro ao gerar convite:', error);
        throw new functions.https.HttpsError('internal', 'Erro ao gerar convite.');
    }
});

exports.validateInvite = functions.https.onCall(async (data, context) => {
    const { inviteId, userEmail } = data;

    if (!inviteId || !userEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing inviteId or userEmail');
    }

    const inviteRef = admin.firestore().collection('convites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists || inviteDoc.data().status !== 'pending' || inviteDoc.data().email !== userEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid or already used invite.');
    }

    await inviteRef.update({ validatedBy: userEmail });

    return { success: true };
});

exports.invalidateInvite = functions.https.onCall(async (data, context) => {
    const { inviteId } = data;
    if (!inviteId) {
        throw new functions.https.HttpsError('invalid-argument', 'InviteId is required.');
    }

    const inviteRef = admin.firestore().collection('convites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Invite not found.');
    }

    const inviteData = inviteDoc.data();

    if (inviteData.status === 'used') {
        throw new functions.https.HttpsError('failed-precondition', 'Invite already used.');
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

    const newUserId = context.auth.uid;
    console.log('newUserId:', newUserId);

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

    return { success: true };
});
