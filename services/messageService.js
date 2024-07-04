// services/messageService.js
const { admin } = require('../firebaseAdmin');
const Message = require('../models/Message');

class MessageService {
  static async getAllMessages() {
    try {
      const db = admin.firestore();
      const messagesRef = db.collection('mensagens');
      const messages = await messagesRef.get();
      console.log('Messages snapshot:', messages);
      const messagesArray = [];
      messages.forEach((doc) => {
        messagesArray.push(doc.data());
      });
      return messagesArray;
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
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