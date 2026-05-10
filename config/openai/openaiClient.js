// config/openai/openaiClient.js
// Instância compartilhada do cliente OpenAI — use este módulo em todos os serviços
// para garantir configuração única (timeout, API key, model) sem duplicação.
const { OpenAI } = require('openai');
const { logger } = require('../../logger');

let openaiClient = null;

if (process.env.OPENAI_API_KEY) {
  try {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000,
    });
    logger.info('Shared OpenAI client initialized', { service: 'openaiClient' });
  } catch (error) {
    logger.error('Failed to initialize shared OpenAI client', {
      service: 'openaiClient',
      error: error.message,
    });
  }
} else {
  logger.warn('OPENAI_API_KEY not set — OpenAI client unavailable', { service: 'openaiClient' });
}

module.exports = openaiClient;
