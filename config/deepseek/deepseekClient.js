// config/deepseek/deepseekClient.js
// Cliente DeepSeek via SDK OpenAI-compatível — use para análise/varredura (QA primário).
// Toda a infra de IA primária deve ser baseada no DeepSeek.
// Reserve o Anthropic/Claude exclusivamente para geração de fix/patch em QA/SRE.
const OpenAI   = require('openai');
const { logger } = require('../../logger');

let deepseekClient = null;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY; // Fallback se necessário, mas DeepSeek é preferido
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

if (DEEPSEEK_API_KEY) {
  try {
    deepseekClient = new OpenAI({
      apiKey:  DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
      timeout: 30000,
    });
    logger.info('DeepSeek client initialized', { 
      service: 'deepseekClient',
      baseUrl: DEEPSEEK_BASE_URL,
      usingFallbackKey: !process.env.DEEPSEEK_API_KEY && !!process.env.OPENAI_API_KEY
    });
  } catch (error) {
    logger.error('Failed to initialize DeepSeek client', {
      service: 'deepseekClient',
      error:   error.message,
    });
  }
} else {
  logger.warn('DEEPSEEK_API_KEY not set — DeepSeek client unavailable', { service: 'deepseekClient' });
}

module.exports = deepseekClient;
