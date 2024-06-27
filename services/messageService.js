// services/messageService.js
const admin = require('firebase-admin');

class MessageService {
  static async getMessageById(id) {
    const doc = await admin.firestore().collection('messages').doc(id).get();
    if (!doc.exists) {
      throw new Error('Mensagem não encontrada.');
    }
    return { id: doc.id, ...doc.data() };
  }

  static async getMessagesByUserId(uid) {
    const snapshot = await admin.firestore().collection('messages').where('uidDestinatario', '==', uid).get();
    if (snapshot.empty) {
      return [];
    }
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createMessage(data) {
    const newMessage = {
      uidRemetente: data.uidRemetente,
      conteudo: data.conteudo,
      tipo: data.tipo,
      uidDestinatario: data.uidDestinatario,
      lido: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await admin.firestore().collection('messages').add(newMessage);
    return { id: docRef.id, ...newMessage };
  }

  static async updateMessage(id, data) {
    const messageRef = admin.firestore().collection('messages').doc(id);
    await messageRef.update(data);
    const updatedDoc = await messageRef.get();
    if (!updatedDoc.exists) {
      throw new Error('Mensagem não encontrada.');
    }
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  static async deleteMessage(id) {
    const messageRef = admin.firestore().collection('messages').doc(id);
    await messageRef.delete();
  }
}

module.exports = MessageService;