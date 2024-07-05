// services/messageService.js
const { admin } = require('../firebaseAdmin');
const Message = require('../models/Message');

class MessageService {
  static async getAllMessages(userId) {
    try {
      const db = admin.firestore();
      const messagesRef = db.collectionGroup('mensagens');
      const collections = await messagesRef.get();
      const userSubcollections = collections.docs.filter(doc => {
        const subcollectionName = doc.ref.path.split('/')[1];
        const [idA, idB] = subcollectionName.split('_');
        return (idA === userId || idB === userId);
      });
    return userSubcollections;
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  }

  static async getMessageById(userId) {
    const userSubcollections = await this.getAllMessages(userId);
    const messages = [];
    for (const subcollection of userSubcollections) {
      const subcollectionRef = subcollection.ref.collection('msgs');
      const subcollectionMessages = await subcollectionRef.get();
      subcollectionMessages.forEach(doc => {
        messages.push(doc.data());
      });
    }
    return messages;
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