/**
 * @fileoverview Controller de reCAPTCHA - verifica tokens de reCAPTCHA para proteção contra bots
 * @module controllers/recaptchaController
 */

const { createAssessment } = require('../services/recaptchaService');

/**
 * Verifica token reCAPTCHA e retorna score de segurança
 * @async
 * @function verifyRecaptcha
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados da verificação
 * @param {string} req.body.token - Token reCAPTCHA
 * @param {string} req.body.action - Ação sendo validada
 * @param {string} req.body.userAgent - User agent do navegador
 * @param {string} req.body.userIpAddress - IP do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Score de segurança (0.0 a 1.0)
 */
exports.verifyRecaptcha = async (req, res) => {
    const { token, action, userAgent, userIpAddress } = req.body;

    try {
        const score = await createAssessment({
            projectID: process.env.RECAPTCHA_PROJECT_ID,
            recaptchaKey: process.env.RECAPTCHA_KEY,
            token,
            recaptchaAction: action,
            userAgent,
            userIpAddress
        });

        if (score === null || score < 0.5) {
            return res.status(400).send('Falha na verificação do reCAPTCHA.');
        }

        res.status(200).send({ score });
    } catch (error) {
        res.status(500).send({ error: 'Erro ao verificar reCAPTCHA', details: error.message });
    }
};
