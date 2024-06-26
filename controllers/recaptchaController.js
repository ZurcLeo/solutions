const { createAssessment } = require('../services/recaptchaService');

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