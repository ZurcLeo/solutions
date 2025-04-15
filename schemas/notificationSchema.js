// schemas/notificationSchema.js
const Joi = require('joi');

const notificationSchema = Joi.object({
  userId: Joi.string().required(),
  notificationId: Joi.string().optional(),
  type: Joi.string().valid('global', 'reacao', 'comentario', 'presente', 'postagem', 'caixinha', 'mensagem', 'amizade_aceita', 'pedido_amizade', 'convite', 'convite_lembrete').optional(),
  conteudo: Joi.string().optional(),
  notificationId: Joi.string().optional(),
  inviteId: Joi.string().optional(),
  url: Joi.string().uri().optional(),
  friendName: Joi.string().optional()
});

module.exports = notificationSchema;
