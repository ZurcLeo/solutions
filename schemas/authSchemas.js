// schemas/authSchemas.js
const Joi = require('joi');
const userSchema = require('./userSchema');

// Schema específico para login com provedor
const loginProviderSchema = Joi.object({
  provider: Joi.string().valid('google', 'facebook', 'microsoft').required(),
  firebaseToken: Joi.string().optional(),
  userId: Joi.string().optional()
});

// Agrupando todos os schemas relacionados à autenticação
const authSchemas = {
    schemas: {
      'login-with-provider': loginProviderSchema,
      'register': userSchema,
      'update-user': userSchema,
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