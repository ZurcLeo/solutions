const { logger } = require('../logger');
const inviteService = require('../services/inviteService');

exports.validateInvite = async (req, res) => {
  logger.info('Validando convite', { service: 'inviteController', function: 'validateInvite', body: req.body });

  const { inviteToken } = req.body;

  if (!inviteToken) {
    logger.warn('Token de convite não fornecido', { service: 'inviteController', function: 'validateInvite' });
    return res.status(400).json({ message: 'Token de convite não fornecido' });
  }

  try {
    const result = await inviteService.validateInvite(inviteToken);
    logger.info('Convite validado com sucesso', { service: 'inviteController', function: 'validateInvite', result });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao validar convite', { service: 'inviteController', function: 'validateInvite', error: error.message });
    res.status(500).json({ message: 'Erro ao validar convite', error: error.message });
  }
};

exports.invalidateInvite = async (req, res) => {
  logger.info('Invalidando convite', { service: 'inviteController', function: 'invalidateInvite', body: req.body });

  const { inviteToken } = req.body;
  const userId = req.user.uid;

  if (!inviteToken) {
    logger.warn('Token de convite não fornecido', { service: 'inviteController', function: 'invalidateInvite' });
    return res.status(400).json({ message: 'Token de convite não fornecido' });
  }

  try {
    await inviteService.invalidateInvite(inviteToken, userId);
    logger.info('Convite invalidado com sucesso', { service: 'inviteController', function: 'invalidateInvite', inviteToken, userId });
    res.status(200).json({ success: true, message: 'Convite invalidado com sucesso' });
  } catch (error) {
    logger.error('Erro ao invalidar convite', { service: 'inviteController', function: 'invalidateInvite', error: error.message });
    res.status(500).json({ message: 'Erro ao invalidar convite', error: error.message });
  }
};

exports.sendInvite = async (req, res) => {
  const { email, friendName } = req.validatedBody;
  logger.info('Enviando convite', {
    service: 'inviteController',
    function: 'sendInvite',
    body: req.validatedBody
  });

  try {
    const result = await inviteService.generateInvite({ email, friendName, userId: req.user.uid });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao enviar convite', {
      service: 'inviteController',
      function: 'sendInvite',
      error: error.message
    });
    res.status(500).json({ message: error.message });
  }
};

exports.getSentInvites = async (req, res) => {
  const userId = req.user.uid;
  logger.info('Buscando convites enviados', { service: 'inviteController', function: 'getSentInvites', userId });

  try {
    const invites = await inviteService.getSentInvites(userId);
    logger.info('Convites enviados obtidos com sucesso', { service: 'inviteController', function: 'getSentInvites', userId, invites });
    res.json(invites);
  } catch (error) {
    logger.error('Erro ao buscar convites enviados', { service: 'inviteController', function: 'getSentInvites', userId, error: error.message });
    res.status(500).json({
      message: 'Erro ao buscar convites.',
      error: error.message,
    });
  }
};

exports.getInviteById = async(req, res) => {
  const {id} = req;
  try {
  const result = await inviteService.getInviteById(id);
  logger.info('Convite encontrado:', { service: 'inviteController', function: 'getInviteById', result });
  res.status(200).json({ message: 'Convite carregado com sucesso:', result });
} catch (error) {
  logger.error('Erro ao buscar convite', { service: 'inviteController', function: 'getInviteById', result, error: error.message });
  res.status(500).json({ message: 'Erro ao cancelar convite' });
  }
}

exports.cancelInvite = async (req, res) => {
  const inviteId = req.params.id;
  logger.info('Cancelando convite', { service: 'inviteController', function: 'cancelInvite', inviteId });

  try {
    await inviteService.cancelInvite(inviteId);
    logger.info('Convite cancelado com sucesso', { service: 'inviteController', function: 'cancelInvite', inviteId });
    res.status(200).json({ message: 'Convite cancelado com sucesso' });
  } catch (error) {
    logger.error('Erro ao cancelar convite', { service: 'inviteController', function: 'cancelInvite', inviteId, error: error.message });
    res.status(500).json({ message: 'Erro ao cancelar convite' });
  }
};