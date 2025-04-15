// controllers/messageController.js
const MessageService = require('../services/messageService');
const Message = require('../models/Message')

exports.getMessageById = async (req, res) => {
  try {
    const { uidRemetente, uidDestinatario, id } = req.params;
    const message = await Message.getById(uidRemetente, uidDestinatario, id);
    res.status(200).json(message);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar mensagem', error: error.message });
  }
};

exports.getMessagesByUserId = async (req, res) => {
  try {
    const {uidRemetente, uidDestinatario} = req.params;
    console.log('userid recebido: ', uidRemetente, uidDestinatario)
    const messages = await Message.getByUserId(uidRemetente, uidDestinatario);
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar mensagens', error: error.message });
  }
};

exports.createMessage = async (req, res) => {
  try {
    const newMessage = req.body;
    console.log('imprimindo body no controlador:', newMessage);
    const message = await MessageService.createMessage(newMessage);
    res.status(201).json(message);
    } catch (error) {
    res.status(500).json({ message: 'Erro ao criar mensagem', error: error.message });
  }
};

exports.updateMessage = async (req, res) => {
  try {
    const { uidRemetente, uidDestinatario, id } = req.params;
    const updatedMessage = await MessageService.updateMessage(uidRemetente, uidDestinatario, id, req.body);
    res.status(200).json({ message: 'Mensagem atualizada com sucesso', updatedMessage });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar mensagem', error: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const { uidRemetente, uidDestinatario, id } = req.params;
    await MessageService.deleteMessage(uidRemetente, uidDestinatario, id);
    res.status(200).json({ message: 'Mensagem deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar mensagem', error: error.message });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const userId = req.uid; 
    const messages = await MessageService.getAllMessages(userId);
    console.log('Messages:', messages);
    res.status(200).json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Erro ao buscar mensagens', error: error.message });
  }
};