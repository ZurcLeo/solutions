const nodemailer = require('nodemailer');
require('dotenv').config();
const { getEmailTemplate } = require('./emailTemplate');

// Defina as variáveis de ambiente para o SMTP
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

// Configure o transporte do nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: smtpUser, // Use variável de ambiente
        pass: smtpPass  // Use variável de ambiente
    },
    tls: {
        ciphers: 'SSLv3'
    }
});

// Função para enviar e-mail
async function sendEmail(to, subject, content) {
    const htmlContent = getEmailTemplate(subject, content);
    const mailOptions = {
        from: 'suporte@eloscloud.com.br',
        to: to,
        subject: subject,
        html: htmlContent,
        text: content.replace(/<[^>]*>?/gm, '') // Remove HTML tags for plain text version
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

module.exports = sendEmail;
