// models/Message.js
const { db } = require('../firebaseAdmin');

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

  static async getById(uidRemetente, uidDestinatario, id) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const doc = await db.collection(path).doc(id).get();
    if (!doc.exists) {
      throw new Error('Mensagem não encontrada.');
    }
    return new Message(doc.data());
  }

  static async getByUserId(uidRemetente, uidDestinatario) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const snapshot = await db.collection(path).get();
    const messages = [];
    snapshot.forEach(doc => {
      messages.push(new Message(doc.data()));
    });
    return messages;
  }

  static async create(data) {
    const message = new Message(data);
    const path = this.getPath(data.uidRemetente, data.uidDestinatario);
    const docRef = await db.collection(path).add({ ...message });
    message.id = docRef.id;
    return message;
  }

  static async update(uidRemetente, uidDestinatario, id, data) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const messageRef = db.collection(path).doc(id);
    await messageRef.update(data);
    const updatedDoc = await messageRef.get();
    return new Message(updatedDoc.data());
  }

  static async delete(uidRemetente, uidDestinatario, id) {
    const path = this.getPath(uidRemetente, uidDestinatario);
    const messageRef = db.collection(path).doc(id);
    await messageRef.delete();
  }

  static getPath(uidA, uidB) {
    return `mensagens/${[uidA, uidB].sort().join('_')}`;
  }
}

module.exports = Message;