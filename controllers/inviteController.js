const inviteService = require('../services/inviteService');
const Invite = require('../models/Invite');

exports.getSentInvites = async (req, res) => {
  const userId = req.user.uid;
  try {
    const invites = await inviteService.getSentInvites(userId);
    res.json(invites);
  } catch (error) {
    console.error('Erro ao enviar convite:', error);
    res.status(500).json({
      message: 'Erro ao enviar convite.',
      error: error.message,
    });
  }
};

exports.createInvite = async (req, res) => {
  try {
    const invite = await inviteService.createInvite(req.body);
    res.status(201).json(invite);
  } catch (error) {
    console.error('Erro ao criar convite:', error);
    res.status(400).json({ message: error.message });
  }
};

exports.updateInvite = async (req, res) => {
  try {
    const invite = await inviteService.updateInvite(req.params.id, req.body);
    res.status(200).json(invite);
  } catch (error) {
    console.error('Erro ao atualizar convite:', error);
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
    console.error('Erro ao deletar convite:', error);
    res.status(400).json({ message: error.message });
  }
};

exports.sendInvite = async (req, res) => {
  try {
    await inviteService.generateInvite(req.body.email, req);
    res.status(201).json({ success: true, message: 'Convite enviado com sucesso.' });
  } catch (error) {
    console.error('Erro ao enviar convite:', error);
    res.status(500).json({ message: 'Erro ao enviar convite.', error: error.message });
  }
};

exports.validateInvite = async (req, res) => {
  const { inviteId, userEmail } = req.body;

  if (!inviteId || !userEmail) {
    return res.status(400).json({ message: 'Faltando inviteId ou userEmail' });
  }

  try {
    await inviteService.validateInvite(inviteId, userEmail);
    res.status(200).json({ success: true, message: 'Convite validado com sucesso.' });
  } catch (error) {
    console.error('Erro ao validar convite:', error);
    res.status(500).json({ message: 'Erro ao validar convite.', error: error.message });
  }
};

exports.invalidateInvite = async (req, res) => {
  const { inviteId } = req.body;
  const newUserId = req.user.uid;

  if (!inviteId) {
    return res.status(400).json({ message: 'inviteId é obrigatório.' });
  }

  try {
    await inviteService.invalidateInvite(inviteId, newUserId);
    res.status(200).json({ success: true, message: 'Convite invalidado com sucesso.' });
  } catch (error) {
    console.error('Erro ao invalidar convite:', error);
    res.status(500).json({ message: 'Erro ao invalidar convite.', error: error.message });
  }
};