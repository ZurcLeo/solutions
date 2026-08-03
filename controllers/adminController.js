const ModerationService = require('../services/ModerationService');
const { logger } = require('../logger');

exports.applyUserModeration = async (req, res) => {
  const { userId }     = req.params;
  const { multiplier, flags } = req.body;
  const adminId = req.user.uid;

  if (multiplier === undefined) {
    return res.status(400).json({ message: 'multiplier é obrigatório. Valores válidos: 1.0, 0.7, 0.4, 0.1' });
  }

  try {
    const result = await ModerationService.applyModeration(userId, multiplier, flags, adminId);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    const status = error.message?.includes('inválido') ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
};
