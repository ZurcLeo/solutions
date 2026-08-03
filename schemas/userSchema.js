const Joi = require('joi');

const userSchema = Joi.object({
  uid: Joi.string().optional(),
  id: Joi.string().optional(),
  userId: Joi.string().optional(),
  nome: Joi.string().optional().allow(''),
  displayName: Joi.string().optional().allow(''),
  username: Joi.string().pattern(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/).optional().allow(null, ''),
  usernameLastChangedAt: Joi.alternatives().try(Joi.date(), Joi.string(), Joi.number()).optional().allow(null),
  telefone: Joi.string().optional().allow('', null),
  email: Joi.string().email().optional(),
  reacoes: Joi.object().optional(),
  perfilPublico: Joi.boolean().optional(),
  ja3Hash: Joi.string().optional().allow(null, ''),
  tipoDeConta: Joi.string().optional().allow(''),
  tipo_de_conta: Joi.string().optional().allow(''),
  perfil_publico: Joi.boolean().optional(),
  isOwnerOrAdmin: Joi.boolean().optional(),
  fotoDoPerfil: Joi.string().optional().allow(null, ''),  // aceita URI, base64 e caminhos
  descricao: Joi.string().optional().allow(''),
  interesses: Joi.alternatives().try(
    Joi.object({
      lazer: Joi.array().items(Joi.string()).optional(),
      bemestar: Joi.array().items(Joi.string()).optional(),
      social: Joi.array().items(Joi.string()).optional(),
      tecnologia: Joi.array().items(Joi.string()).optional(),
      negocios: Joi.array().items(Joi.string()).optional(),
      marketing: Joi.array().items(Joi.string()).optional(),
      educacao: Joi.array().items(Joi.string()).optional(),
      marketplace: Joi.array().items(Joi.string()).optional(),
      sustentabilidade: Joi.array().items(Joi.string()).optional(),
    }),
    Joi.object()  // aceita qualquer objeto de interesses (categorias dinâmicas)
  ).optional(),
  amigosAutorizados: Joi.array().items(Joi.string()).optional(),
  amigos: Joi.array().items(Joi.string()).optional(),
  dataCriacao: Joi.alternatives().try(Joi.date(), Joi.number(), Joi.string()).optional(),
  saldoElosCoins: Joi.number().optional(),
  conversas: Joi.alternatives().try(
    Joi.object(),           // formato legado: objeto { chatId: {...} }
    Joi.array().items(Joi.string())
  ).optional(),
  emailVerified: Joi.boolean().optional(),
  providerData: Joi.array().items(
    Joi.object({
      uid: Joi.string().optional(),
      displayName: Joi.string().optional(),
      email: Joi.string().email().optional(),
      providerId: Joi.string().optional(),
    })
  ).optional()
}).unknown(true);  // permite campos extras (roles, caixinhas, isFirstAccess, etc.) sem rejeitar

module.exports = userSchema;