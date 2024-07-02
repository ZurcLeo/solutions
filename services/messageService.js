// services/messageService.js
const Message = require('../models/Message');

class MessageService {
  static async getAllMessages() {
    const snapshot = await db.collectionGroup('mensagens').get();
    const messages = [];
    snapshot.forEach(doc => {
      messages.push(new Message(doc.data()));
    });
    return messages;
  }

  static async getMessageById(uidRemetente, uidDestinatario, id) {
    return await Message.getById(uidRemetente, uidDestinatario, id);
  }

  static async getMessagesByUserId(uidRemetente, uidDestinatario) {
    return await Message.getByUserId(uidRemetente, uidDestinatario);
  }

  static async createMessage(data) {
    return await Message.create(data);
  }

  static async updateMessage(uidRemetente, uidDestinatario, id, data) {
    return await Message.update(uidRemetente, uidDestinatario, id, data);
  }

  static async deleteMessage(uidRemetente, uidDestinatario, id) {
    return await Message.delete(uidRemetente, uidDestinatario, id);
  }
}

module.exports = MessageService;