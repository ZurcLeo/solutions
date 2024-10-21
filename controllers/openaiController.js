// controllers/openaiController.js
const { OpenAI } = require('openai');
const { logger } = require('../logger');

// Configuração do cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const validateText = async (req, res) => {
  const { text } = req.body;

  try {
    // Logando a entrada recebida
    logger.info('Validando texto com OpenAI', {
      service: 'openai',
      function: 'validateText',
      text
    });

    // Chamada para a API da OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `Analyze the following text for any inappropriate language, grammatical errors, or negative sentiments: "${text}"` },
      ],
      max_tokens: 150,
    });

    const validation = response.choices[0].message.content.trim();

    // Logando a resposta da OpenAI
    logger.info('Resposta da OpenAI recebida', {
      service: 'openai',
      function: 'validateText',
      validation
    });

    res.json({ validation });
  } catch (error) {
    logger.error('Erro ao validar texto com OpenAI', {
      service: 'openai',
      function: 'validateText',
      error: error.message
    });
    res.status(500).json({ error: 'Erro ao validar texto com OpenAI' });
  }
};

module.exports = {
  validateText,
};