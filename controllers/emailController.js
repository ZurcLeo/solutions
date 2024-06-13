const { sendEmail } = require('../services/emailService');

exports.sendInviteEmail = async (req, res) => {
    const { email, subject, content } = req.body;

    try {
        await sendEmail(email, subject, content);
        res.status(200).send('Email enviado com sucesso.');
    } catch (error) {
        res.status(500).send({ error: 'Erro ao enviar email', details: error.message });
    }
};
