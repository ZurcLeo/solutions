// services/messageService.js
const { getFirestore } = require('../firebaseAdmin');
const Message = require('../models/Message');

const db = getFirestore();

class MessageService {
  static async getAllMessages(userId) {
    try {
      const messagesRef = db.collectionGroup('conversations');
      const collections = await messagesRef.get();
      const userSubcollections = collections.docs.filter(doc => {
        const subcollectionName = doc.ref.path.split('/')[1];
        const [idA, idB] = subcollectionName.split('_');
        return (idA === userId || idB === userId);
      });
  
      const messages = userSubcollections.map(doc => ({
        id: doc.id,
        conversationId: doc.ref.parent.parent.id, // Pega o ID da conversa (nome da subcoleção)
        ...doc.data(),
        timestamp: doc.data().timestamp?.toMillis() || Date.now(),
      }));
  
      return messages;
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  }

  static async getMessageById(userId) {
    console.log('userid recebido servico: ', userId)

    const userSubcollections = await this.getAllMessages(userId);
    const messages = {};
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

  static async createMessage(newMessage) {
    const data = newMessage;
    console.log('imprimindo mensagem no servico:', data);
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