//controllers/emailController.js
const { sendEmail } = require('../services/emailService');

exports.sendInviteEmail = async (req, res) => {
    const { to, subject, message } = req.body;

    if (!to || !subject || !message) {
        return res.status(400).json({ message: 'Parâmetros inválidos' });
    }

    try {
        await sendEmail(to, subject, message);
        res.status(200).json({ message: 'Convite enviado com sucesso' });
    } catch (error) {
        console.error('Erro ao enviar convite:', error);
        res.status(500).json({ message: 'Erro ao enviar convite', error: error.message });
    }
};
