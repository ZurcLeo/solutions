//services/emailService.js
const nodemailer = require('nodemailer');
const { createNotification } = require('./notificationService');
require('dotenv').config();

const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: {
        user: smtpUser,
        pass: smtpPass
    },
    tls: {
        ciphers: 'SSLv3'
    }
});

const getEmailTemplate = (subject, content) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
        body {
            font-family: 'Poppins', Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        .email-container {
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            border: 1px solid #dddddd;
            border-radius: 8px;
            overflow: hidden;
        }
        .header {
            background-color: #345C72;
            color: white;
            text-align: center;
            padding: 20px;
            font-size: 24px;
        }
        .body {
            padding: 20px;
            font-size: 16px;
            color: #333333;
            line-height: 1.6;
        }
        .body a {
            color: #345C72;
            text-decoration: none;
        }
        .footer {
            background-color: #333333;
            color: white;
            text-align: center;
            padding: 10px;
            font-size: 14px;
        }
        @media screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: auto;
                border-radius: 0;
            }
            .header, .body, .footer {
                padding: 10px !important;
            }
        }
    </style>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
</head>
<body>
    <div class="email-container">
        <div class="header">
            ${subject}
        </div>
        <div class="body">
                                    ${content}
                              </div>
        <div class="footer">
            Copyright &copy; 2024 | ElosCloud
        </div>
    </div>
</body>
</html>
    `;
  };

const sendEmail = async (to, subject, content, userId) => {
    const htmlContent = getEmailTemplate(subject, content);
    const mailOptions = {
        from: 'suporte@eloscloud.com.br',
        to: to,
        subject: subject,
        html: htmlContent,
        text: content.replace(/<[^>]*>?/gm, '')
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
        await createNotification({
            userId,
            type: 'email_enviado',
            conteudo: `Email sent to ${to} successfully.`,
            url: 'https://eloscloud.com'
        });
    } catch (error) {
        console.error('Error sending email:', error);
    }
};

module.exports = { sendEmail };
