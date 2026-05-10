// config/anthropic/anthropicClient.js
// Instância compartilhada do cliente Anthropic — use este módulo em todos os serviços.
const { Anthropic } = require('@anthropic-ai/sdk');
const { logger } = require('../../logger');

let anthropicClient = null;

if (process.env.ANTHROPIC_API_KEY) {
  try {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 30000,
    });
    logger.info('Shared Anthropic client initialized', { service: 'anthropicClient' });
  } catch (error) {
    logger.error('Failed to initialize shared Anthropic client', {
      service: 'anthropicClient',
      error: error.message,
    });
  }
} else {
  logger.warn('ANTHROPIC_API_KEY not set — Anthropic client unavailable', { service: 'anthropicClient' });
}

module.exports = anthropicClient;
