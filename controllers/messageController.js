// controllers/messageController.js
const admin = require('firebase-admin');

exports.getMessageById = async (req, res) => {
  try {
    const messageRef = admin.firestore().collection('messages').doc(req.params.id);
    const messageDoc = await messageRef.get();
    if (!messageDoc.exists) {
      return res.status(404).json({ message: 'Mensagem não encontrada' });
    }
    res.status(200).json(messageDoc.data());
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar mensagem', error: error.message });
  }
};

exports.getMessagesByUserId = async (req, res) => {
  try {
    const messagesRef = admin.firestore().collection('messages').where('uidDestinatario', '==', req.params.uid);
    const messagesSnapshot = await messagesRef.get();
    if (messagesSnapshot.empty) {
      return res.status(404).json({ message: 'Nenhuma mensagem encontrada' });
    }
    const messages = messagesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar mensagens', error: error.message });
  }
};

exports.createMessage = async (req, res) => {
  try {
    const newMessage = {
      uidRemetente: req.body.uidRemetente,
      conteudo: req.body.conteudo,
      tipo: req.body.tipo,
      uidDestinatario: req.body.uidDestinatario,
      lido: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    const messageRef = await admin.firestore().collection('messages').add(newMessage);
    res.status(201).json({ id: messageRef.id, ...newMessage });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar mensagem', error: error.message });
  }
};

exports.updateMessage = async (req, res) => {
  try {
    const messageRef = admin.firestore().collection('messages').doc(req.params.id);
    await messageRef.update(req.body);
    res.status(200).json({ message: 'Mensagem atualizada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar mensagem', error: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const messageRef = admin.firestore().collection('messages').doc(req.params.id);
    await messageRef.delete();
    res.status(200).json({ message: 'Mensagem deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar mensagem', error: error.message });
  }
};