// schemas/notificationSchema.js
const Joi = require('joi');

const notificationSchema = Joi.object({
  userId: Joi.string().required(),
  type: Joi.string().valid('global', 'reacao', 'comentario', 'presente', 'postagem', 'caixinha', 'mensagem', 'amizade_aceita', 'pedido_amizade', 'convite').required(),
  conteudo: Joi.string().optional(),
  inviteId: Joi.string().optional(),
  url: Joi.string().uri().optional(),
  friendName: Joi.string().optional()
});

module.exports = notificationSchema;
