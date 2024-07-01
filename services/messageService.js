// services/messageService.js
const { db } = require('../firebaseAdmin');

class MessageService {
  static async getMessageById(uidRemetente, uidDestinatario, id) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const doc = await db().collection(path).doc(id).get();
    if (!doc.exists) {
      throw new Error('Mensagem não encontrada.');
    }
    return { id: doc.id, ...doc.data() };
  }

  static async getMessagesByUserId(uidRemetente, uidDestinatario) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const snapshot = await db().collection(path).get();
    if (snapshot.empty) {
      return [];
    }
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createMessage(data) {
    const path = this.getPath(data.uidRemetente, data.uidDestinatario);
    const newMessage = {
      uidRemetente: data.uidRemetente,
      conteudo: data.conteudo,
      tipo: data.tipo,
      uidDestinatario: data.uidDestinatario,
      lido: false,
      timestamp: firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await db().collection(path).add(newMessage);
    return { id: docRef.id, ...newMessage };
  }

  static async updateMessage(uidRemetente, uidDestinatario, id, data) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const messageRef = db().collection(path).doc(id);
    await messageRef.update(data);
    const updatedDoc = await messageRef.get();
    if (!updatedDoc.exists) {
      throw new Error('Mensagem não encontrada.');
    }
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  static async deleteMessage(uidRemetente, uidDestinatario, id) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const messageRef = db().collection(path).doc(id);
    await messageRef.delete();
  }

  static getPath(uidA, uidB) {
    return `mensagens/${[uidA, uidB].sort().join('_')}`;
  }
}

module.exports = MessageService;