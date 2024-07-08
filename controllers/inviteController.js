const inviteService = require('../services/inviteService');

exports.getSentInvites = async (req, res) => {
  if (!req.body) {
    return res.status(401).json({ message: 'Requisição não possui UID.' });
  }
  const uid = req.body; 

  try {
    const invites = await inviteService.getSentInvites(uid);
    res.status(200).json(invites);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createInvite = async (req, res) => {
  try {
    const invite = await inviteService.createInvite(req.body);
    res.status(201).json(invite);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateInvite = async (req, res) => {
  try {
    const invite = await inviteService.updateInvite(req.params.id, req.body);
    res.status(200).json(invite);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.cancelInvite = async (req, res) => {
  const inviteId = req.params.id;
  try {
    await inviteService.cancelInvite(inviteId);
    res.status(200).json({ message: 'Convite cancelado com sucesso' });
  } catch (error) {
    console.error('Erro ao cancelar convite:', error);
    res.status(500).json({ message: 'Erro ao cancelar convite' });
  }
};

exports.deleteInvite = async (req, res) => {
  try {
    await inviteService.deleteInvite(req.params.id);
    res.status(200).json({ message: 'Convite deletado com sucesso.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.sendInvite = async (req, res) => {
  try {
    await inviteService.generateInvite(req.body.email, req);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao gerar convite:', error);
    return res.status(500).json({ message: 'Erro ao gerar convite.' });
  }
};

exports.validateInvite = async (req, res) => {
  const { inviteId, userEmail } = req.body;

  if (!inviteId || !userEmail) {
    return res.status(400).json({ message: 'Missing inviteId or userEmail' });
  }

  try {
    await inviteService.validateInvite(inviteId, userEmail);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao validar convite:', error);
    return res.status(500).json({ message: 'Erro ao validar convite.' });
  }
};

exports.invalidateInvite = async (req, res) => {
  const { inviteId } = req.body;
  const newUserId = req.user.uid;

  if (!inviteId) {
    return res.status(400).json({ message: 'InviteId is required.' });
  }

  try {
    await inviteService.invalidateInvite(inviteId, newUserId);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao invalidar convite:', error);
    return res.status(500).json({ message: 'Erro ao invalidar convite.' });
  }
};