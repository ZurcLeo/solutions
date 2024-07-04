// services/messageService.js
const { admin } = require('../firebaseAdmin');
const Message = require('../models/Message');

class MessageService {
  static async getAllMessages(userId) {
    try {
      const db = admin.firestore();
      const messagesRef = db.collection('mensagens');
      const subcollections = await messagesRef.listCollections();
      const userSubcollections = subcollections.filter(subcollection => {
        const subcollectionName = subcollection.id;
        return subcollectionName.startsWith(`${userId}_`) || subcollectionName.endsWith(`_${userId}`);
      });
      const messages = [];
      for (const subcollection of userSubcollections) {
        const subcollectionRef = subcollection.firestore.collection(subcollection.id);
        const querySnapshot = await subcollectionRef.get();
        querySnapshot.forEach(doc => {
          messages.push(doc.data());
        });
      }
      return messages;
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