const ActiveConnection = require('../models/ActiveConnection');
const InactiveConnection = require('../models/InactiveConnection');
const RequestedConnection = require('../models/RequestedConnection');
const connectionService = require('../services/connectionService')
const { logger } = require('../logger');

exports.addBestFriend = async (req, res) => {
  const { friendId } = req.params;
  const userId = req.user.uid;

  if (!userId) {
    return res.status(401).json({ message: 'Usuário não autenticado.' });
  }

  if (!friendId) {
    return res.status(400).json({ message: 'O ID do amigo é obrigatório.' });
  }

  try {
    // Chamar a função específica para adicionar melhor amigo no serviço
    await ActiveConnection.addBestFriend(userId, friendId);
    return res.status(200).json({ message: 'Melhor amigo adicionado com sucesso.' });
  } catch (error) {
    if (error.message === 'Usuário não encontrado.') {
      return res.status(404).json({ message: error.message });
    }
    if (
      error.message === 'Este amigo não é uma conexão ativa.' ||
      error.message === 'Este amigo não está na sua lista de amigos.'
    ) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Erro ao adicionar melhor amigo no controlador:', error);
    return res.status(500).json({ message: 'Erro interno ao processar a requisição.' });
  }
};

exports.removeBestFriend = async (req, res) => {
  const { friendId } = req.params;
  const userId = req.user.uid;

  if (!userId) {
    return res.status(401).json({ message: 'Usuário não autenticado.' });
  }

  if (!friendId) {
    return res.status(400).json({ message: 'O ID do amigo é obrigatório.' });
  }

  try {
    // Chamar a função específica para remover melhor amigo no serviço
    await ActiveConnection.removeBestFriend(userId, friendId);
    return res.status(200).json({ message: 'Melhor amigo removido com sucesso.' });
  } catch (error) {
    if (error.message === 'Usuário não encontrado.') {
      return res.status(404).json({ message: error.message });
    }
    if (
      error.message === 'Este amigo não é uma conexão ativa.' ||
      error.message === 'Este amigo não está na sua lista de amigos.'
    ) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Erro ao remover melhor amigo no controlador:', error);
    return res.status(500).json({ message: 'Erro interno ao processar a requisição.' });
  }
};

exports.getActiveConnectionById = async (req, res) => {
  const userId = req.uid;
  logger.info('loggando o usuario nas conexoes', userId);
  try {
    const connections = await ActiveConnection.getById(userId);
    const sentRequests = await RequestedConnection.getRequestsSentByUser(userId);
    const receivedRequests = await RequestedConnection.getPendingRequestsForUser(userId);

    const connection = {
      friends: connections.friends,
      bestFriends: connections.bestFriends,
      sentRequests,
      receivedRequests
    };
    
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.getConnectionsByUserId = async (req, res) => {
  const { userId } = req.params;

  try {
    const { friends, bestFriends } = await connectionService.getConnectionsByUserId(userId);
    res.status(200).json({ friends, bestFriends });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.acceptConnectionRequest = async (req, res) => {
  const { senderId } = req.params; // ID do remetente da solicitação
  const receiverId = req.user.uid; // ID do usuário autenticado (destinatário)
  
  if (!receiverId) {
    return res.status(401).json({ message: 'Usuário não autenticado.' });
  }
  
  if (!senderId) {
    return res.status(400).json({ message: 'ID do remetente é obrigatório.' });
  }
  
  try {
    const result = await RequestedConnection.acceptConnectionRequest(receiverId, senderId);
    
    return res.status(200).json({ 
      message: 'Solicitação de amizade aceita com sucesso.',
      connection: result
    });
  } catch (error) {
    logger.error('Erro ao aceitar solicitação de amizade', {
      service: 'connectionsController',
      method: 'acceptConnectionRequest',
      userId,
      requestId,
      error: error.message
    });
    
    // Mensagens de erro mais específicas para o frontend
    if (error.message === 'Solicitação não encontrada') {
      return res.status(404).json({ message: error.message });
    }
    
    if (error.message === 'Esta solicitação já foi processada') {
      return res.status(400).json({ message: error.message });
    }
    
    return res.status(500).json({ 
      message: 'Erro ao aceitar solicitação de amizade.',
      error: error.message 
    });
  }
};

exports.createActiveConnection = async (req, res) => {
  // Este método deveria ser deprecado ou usado apenas para fins administrativos
  // Uma mensagem de aviso para os desenvolvedores:
  logger.warn('O método createActiveConnection foi chamado diretamente. Para aceitar solicitações de amizade, use acceptConnectionRequest.', {
    service: 'connectionsController',
    method: 'createActiveConnection',
    userId: req.user?.uid
  });
  
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
    await ActiveConnection.delete(req.params.friendId);
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
  const userId = req.params.userId;
  const status = req.query.status;
  try {
    const connection = await RequestedConnection.getPendingRequestsForUser(userId);
    res.status(200).json(connection);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createRequestedConnection = async (req, res) => {
  const { userId, friendId } = req.body;

  if (!userId || !friendId) {
    return res.status(400).json({ message: 'IDs de usuário e amigo são obrigatórios.' });
  }

  try {
    // 1. Verificar se a conexão ativa já existe
    const connectionExists = await ActiveConnection.exists(userId, friendId);
    
    if (connectionExists) {
      return res.status(400).json({ 
        message: 'Vocês já são amigos.',
        code: 'ALREADY_CONNECTED'
      });
    }

    // 2. Verificar solicitação do usuário para o amigo
    const outgoingRequest = await RequestedConnection.findOne({
      userId: userId,
      friendId: friendId
    });

    if (outgoingRequest) {
      return res.status(400).json({ 
        message: 'Você já enviou uma solicitação para este usuário.',
        code: 'REQUEST_ALREADY_SENT',
        requestId: outgoingRequest.id
      });
    }

    // 3. Verificar se existe solicitação do amigo para o usuário
    const incomingRequest = await RequestedConnection.findOne({
      userId: friendId,
      friendId: userId
    });

    if (incomingRequest) {
      return res.status(400).json({ 
        message: 'Este usuário já enviou uma solicitação para você. Você pode aceitá-la na sua lista de solicitações pendentes.',
        code: 'REQUEST_ALREADY_RECEIVED',
        requestId: incomingRequest.id
      });
    }

    // 4. Criar a solicitação se não existir nenhuma das condições acima
    const connection = await RequestedConnection.create(userId, friendId);

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