// schemas/userSchema.js
const Joi = require('joi');

const userSchema = Joi.object({
  uid: Joi.string().optional(),
  id: Joi.string().optional(),
  userId: Joi.string().optional(),
  nome: Joi.string().optional(),
  displayName: Joi.string().optional(),
  email: Joi.string().email().optional(),
  reacoes: Joi.object().optional(),
  perfilPublico: Joi.boolean().optional(),
  ja3Hash: Joi.string().optional(),
  tipoDeConta: Joi.string().optional(),
  isOwnerOrAdmin: Joi.boolean().optional(),
  fotoDoPerfil: Joi.string().uri().optional(),
  descricao: Joi.string().optional(),
  interessesNegocios: Joi.array().items(Joi.string()).optional(),
  amigosAutorizados: Joi.array().items(Joi.string()).optional(),
  amigos: Joi.array().items(Joi.string()).optional(),
  interessesPessoais: Joi.array().items(Joi.string()).optional(),
  dataCriacao: Joi.date().timestamp().optional(),
  saldoElosCoins: Joi.number().optional(),
  conversasComMensagensNaoLidas: Joi.array().items(Joi.string()).optional(),
  emailVerified: Joi.boolean().optional(),
  providerData: Joi.array().items(
    Joi.object({
      uid: Joi.string().optional(),
      displayName: Joi.string().optional(),
      email: Joi.string().email().optional(),
      providerId: Joi.string().optional(),
    })
  ).optional()
});

module.exports = userSchema;