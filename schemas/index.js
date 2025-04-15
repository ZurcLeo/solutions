// schemas/index.js
const { authSchemas } = require('./authSchemas');
const userSchema = require('./userSchema');

// Objeto central que agrupa todos os schemas da aplicação
const schemas = {
  auth: authSchemas,
  user: {
    schemas: {
      'profile': userSchema,
      'settings': userSchema,
      default: userSchema
    }
  }
};

module.exports = schemas;