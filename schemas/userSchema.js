// schemas/userSchema.js
const Joi = require('joi');

const userSchema = Joi.object({
  id: Joi.string().required(),
  uid: Joi.string().optional(),
  nome: Joi.string().required(),
  email: Joi.string().email().required(),
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
  dataCriacao: Joi.date().optional(),
  saldoElosCoins: Joi.number().optional(),
  conversasComMensagensNaoLidas: Joi.array().items(Joi.string()).optional(),
});

module.exports = userSchema;