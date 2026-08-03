// schemas/authSchemas.js
const Joi = require('joi');
const userSchema = require('./userSchema');

// Schema específico para login com provedor
const loginProviderSchema = Joi.object({
  provider: Joi.string().valid('google', 'facebook', 'microsoft').required(),
  firebaseToken: Joi.string().optional(),
  userId: Joi.string().optional()
});

// Schema para troca de token Firebase por JWT
const getTokenSchema = Joi.object({
  firebaseToken: Joi.string().required(),
  ja3Data: Joi.object().optional()
}).options({ allowUnknown: true });

// Schema para renovação de token
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
  ja3Data: Joi.object().optional()
}).options({ allowUnknown: true });

// Agrupando todos os schemas relacionados à autenticação
const authSchemas = {
    schemas: {
      'login-with-provider': loginProviderSchema,
      'register': Joi.object({
        firebaseToken: Joi.string().required(),
        inviteId: Joi.string().optional(),
        profileData: Joi.object().optional(),
        ja3Data: Joi.object().optional()
      }).options({ allowUnknown: true }),
      'update-user': userSchema,
      'token': getTokenSchema,
      'refresh-token': refreshTokenSchema,
      'reset-password': Joi.object({
        email: Joi.string().email().required()
      }),
      'change-password': Joi.object({
        oldPassword: Joi.string().required(),
        newPassword: Joi.string().required().min(8)
      })
    },
    default: userSchema
  };

module.exports = {
  authSchemas,
  loginProviderSchema,
  userSchema
};