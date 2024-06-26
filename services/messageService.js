// services/messageService.js
const Message = require('../models/Message');

class MessageService {
  static async getMessageById(id) {
    return await Message.getById(id);
  }

  static async getMessagesByUserId(uid) {
    return await Message.getByUserId(uid);
  }

  static async createMessage(data) {
    return await Message.create(data);
  }

  static async updateMessage(id, data) {
    return await Message.update(id, data);
  }

  static async deleteMessage(id) {
    await Message.delete(id);
  }
}

module.exports = MessageService;