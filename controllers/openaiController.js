/**
 * @fileoverview Controller de OpenAI - integração com API da OpenAI para validação de texto
 * @module controllers/openaiController
 */

const deepseekClient = require('../config/deepseek/deepseekClient');
const { logger } = require('../logger');

// Configuração do modelo
const AI_MODEL_NAME = process.env.DEEPSEEK_MODEL_NAME || 'deepseek-chat';

/**
 * Valida texto usando DeepSeek para detectar linguagem inapropriada, erros gramaticais ou sentimentos negativos
 * @async
 * @function validateText
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados da validação
 * @param {string} req.body.text - Texto a ser validado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Análise do texto pelo DeepSeek
 */
const validateText = async (req, res) => {
  const { text } = req.body;

  if (!deepseekClient) {
    logger.warn('DeepSeek client not available for text validation', { service: 'openaiController' });
    return res.json({ validation: "Serviço de validação temporariamente indisponível." });
  }

  try {
    // Logando a entrada recebida
    logger.info('Validando texto com DeepSeek', {
      service: 'deepseek',
      function: 'validateText',
      text: text?.substring(0, 50) + '...'
    });

    // Chamada para a API do DeepSeek
    const response = await deepseekClient.chat.completions.create({
      model: AI_MODEL_NAME,
      messages: [
        { role: "system", content: "Você é um assistente útil especializado em análise de conteúdo e gramática em português brasileiro." },
        { role: "user", content: `Analise o seguinte texto em busca de linguagem inapropriada, erros gramaticais ou sentimentos negativos. Seja direto: "${text}"` },
      ],
      max_tokens: 300,
    });

    const validation = response.choices[0].message.content.trim();

    // Logando a resposta do DeepSeek
    logger.info('Resposta do DeepSeek recebida', {
      service: 'deepseek',
      function: 'validateText',
      validation: validation.substring(0, 50) + '...'
    });

    res.json({ validation });
  } catch (error) {
    logger.error('Erro ao validar texto com DeepSeek', {
      service: 'deepseek',
      function: 'validateText',
      error: error.message
    });
    res.status(500).json({ error: 'Erro ao validar texto com DeepSeek' });
  }
};

module.exports = {
  validateText,
};