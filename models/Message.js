// models/Message.js
const admin = require('firebase-admin');
const firestore = admin.firestore();

class Message {
  constructor(data) {
    this.id = data.id;
    this.uidRemetente = data.uidRemetente;
    this.conteudo = data.conteudo;
    this.tipo = data.tipo;
    this.uidDestinatario = data.uidDestinatario;
    this.lido = data.lido || false;
    this.timestamp = data.timestamp ? new Date(data.timestamp.seconds * 1000) : new Date();
    this.dataLeitura = data.dataLeitura ? new Date(data.dataLeitura.seconds * 1000) : null;
  }

  static async getById(id) {
    const doc = await firestore.collection('mensagens').doc(id).get();
    if (!doc.exists) {
      throw new Error('Mensagem não encontrada.');
    }
    return new Message(doc.data());
  }

  static async getByUserId(uid) {
    const snapshot = await firestore.collection('mensagens').where('uidRemetente', '==', uid).get();
    const messages = [];
    snapshot.forEach(doc => {
      messages.push(new Message(doc.data()));
    });
    return messages;
  }

  static async create(data) {
    const message = new Message(data);
    const docRef = await firestore.collection('mensagens').add({ ...message });
    message.id = docRef.id;
    return message;
  }

  static async update(id, data) {
    const messageRef = firestore.collection('mensagens').doc(id);
    await messageRef.update(data);
    const updatedDoc = await messageRef.get();
    return new Message(updatedDoc.data());
  }

  static async delete(id) {
    const messageRef = firestore.collection('mensagens').doc(id);
    await messageRef.delete();
  }
}

module.exports = Message;