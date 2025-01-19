const ActiveConnection = require('../models/ActiveConnection');
const InactiveConnection = require('../models/InactiveConnection');
const RequestedConnection = require('../models/RequestedConnection');
const notificationService = require('../services/notificationService')
const { logger } = require('../logger');

exports.getActiveConnectionById = async (req, res) => {
  try {
    const connection = await ActiveConnection.getById(req.params.id);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.getConnectionsByUserId = async (req, res) => {
  const { userId } = req.params;

  try {
    const { friends, bestFriends } = await ActiveConnection.getConnectionsByUserId(userId);
    res.status(200).json({ friends, bestFriends });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createActiveConnection = async (req, res) => {
  try {
    const connection = await ActiveConnection.create(req.body);
    res.status(201).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateActiveConnection = async (req, res) => {
  try {
    const connection = await ActiveConnection.update(req.params.id, req.body);
    res.status(200).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteActiveConnection = async (req, res) => {
  try {
    await ActiveConnection.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getInactiveConnectionById = async (req, res) => {
  try {
    const connection = await InactiveConnection.getById(req.params.id);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createInactiveConnection = async (req, res) => {
  try {
    const connection = await InactiveConnection.create(req.body);
    res.status(201).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateInactiveConnection = async (req, res) => {
  try {
    const connection = await InactiveConnection.update(req.params.id, req.body);
    res.status(200).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteInactiveConnection = async (req, res) => {
  try {
    await InactiveConnection.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRequestedConnectionById = async (req, res) => {
  try {
    const connection = await RequestedConnection.getById(req.params.id);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createRequestedConnection = async (req, res) => {
  const { userId, friendId } = req.body;

  try {
    // First check if connection already exists using the exists method
    const connectionExists = await ActiveConnection.exists(userId, friendId);
    if (connectionExists) {
      return res.status(400).json({ 
        message: 'Conexão já existe' 
      });
    }

    // Check for existing pending request
    const existingRequest = await RequestedConnection.findOne({ 
      userId, 
      friendId,
      status: 'pending' 
    });
    if (existingRequest) {
      return res.status(400).json({ 
        message: 'Solicitação já enviada' 
      });
    }

    // Create new request
    const connection = await RequestedConnection.create({
      userId,
      friendId,
      status: 'pending',
      createdAt: new Date()
    });

    // Create notification
    await notificationService.createNotification({
      userId: friendId,
      data: {
        senderId: userId,
        type: 'friendRequest',
        requestId: connection.id
      }
    });

    logger.info('Solicitação de conexão criada com sucesso', {
      service: 'connectionsController',
      method: 'createRequestedConnection',
      connectionId: connection.id,
      userId,
      friendId
    });

    res.status(201).json({
      message: 'Solicitação enviada com sucesso',
      connection
    });

  } catch (error) {
    logger.error('Erro ao criar solicitação de conexão', {
      service: 'connectionsController',
      method: 'createRequestedConnection',
      error: error.message,
      userId,
      friendId
    });

    res.status(500).json({ 
      message: 'Erro ao criar solicitação',
      error: error.message 
    });
  }
};

exports.updateRequestedConnection = async (req, res) => {
  try {
    const connection = await RequestedConnection.update(req.params.id, req.body);
    res.status(200).json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteRequestedConnection = async (req, res) => {
  try {
    await RequestedConnection.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
