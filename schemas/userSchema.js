const Joi = require('joi');

const userSchema = Joi.object({
  uid: Joi.string().optional(),
  id: Joi.string().optional(),
  userId: Joi.string().optional(),
  nome: Joi.string().optional(),
  displayName: Joi.string().optional(),
  telefone: Joi.string().optional(),
  email: Joi.string().email().optional(),
  reacoes: Joi.object().optional(),
  perfilPublico: Joi.boolean().optional(),
  ja3Hash: Joi.string().optional(),
  tipoDeConta: Joi.string().optional(),
  isOwnerOrAdmin: Joi.boolean().optional(),
  fotoDoPerfil: Joi.string().uri().optional(),
  descricao: Joi.string().optional(),
  interesses: Joi.object({
    lazer: Joi.array().items(Joi.string()).optional(),
    bemestar: Joi.array().items(Joi.string()).optional(),
    social: Joi.array().items(Joi.string()).optional(),
    tecnologia: Joi.array().items(Joi.string()).optional(),
    negocios: Joi.array().items(Joi.string()).optional(),
    marketing: Joi.array().items(Joi.string()).optional(),
    educacao: Joi.array().items(Joi.string()).optional(),
    marketplace: Joi.array().items(Joi.string()).optional(),
    sustentabilidade: Joi.array().items(Joi.string()).optional(),
  }).optional(),
  amigosAutorizados: Joi.array().items(Joi.string()).optional(),
  amigos: Joi.array().items(Joi.string()).optional(),
  dataCriacao: Joi.date().timestamp().optional(),
  saldoElosCoins: Joi.number().optional(),
  conversas: Joi.array().items(Joi.string()).optional(),
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