//services/emailService.js
const nodemailer = require('nodemailer');
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
          @media screen and (max-width: 600px) {
           .content {
              width: 100%!important;
              display: block!important;
              padding: 10px!important;
            }
           .header,.body,.footer {
              padding: 20px!important;
            }
          }
          body {
            font-family: 'Poppins', sans-serif;
            font-size: 18px; /* increased font size for better readability */
            line-height: 1.6;
          }
         .header {
            background-color: #345C72;
            padding: 40px;
            text-align: center;
            color: white;
            font-size: 24px;
          }
         .body {
            padding: 40px;
            text-align: left;
          }
         .footer {
            background-color: #333333;
            padding: 40px;
            text-align: center;
            color: white;
            font-size: 14px;
          }
          a {
            text-decoration: none;
            color: #345C72;
          }
          a:hover {
            color: #666; /* added hover effect */
          }
          ul {
            list-style: none;
            padding: 0;
            margin: 0;
          }
          ul li {
            margin-bottom: 10px;
          }
        </style>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
      </head>
      <body>
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="padding: 20px;">
              <table class="content" width="600" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: 1px solid #cccccc;">
                <tr>
                  <td class="header">
                    <img src="https://example.com/logo.png" alt="ElosCloud Logo" width="120" height="30" style="margin-bottom: 10px;">
                    <h1>${subject}</h1>
                  </td>
                </tr>
                <tr>
                  <td class="body">
                    <p>${content}</p>
                    <p style="margin-top: 20px;">
                      Need help or have questions? <a href="https://example.com/contact">Contact us</a>
                    </p>
                    <ul>
                      <li><a href="https://example.com/terms">Terms of Use</a></li>
                      <li><a href="https://example.com/privacy">Privacy Policy</a></li>
                    </ul>
                  </td>
                </tr>
                <tr>
                  <td class="footer">
                    <p>Copyright &copy; 2024 | ElosCloud</p>
                    <p style="margin-top: 10px;">
                      Follow us:
                      <ul>
                        <li><a href="https://example.com/facebook"><i class="fa fa-facebook" aria-hidden="true"></i></a></li>
                        <li><a href="https://example.com/twitter"><i class="fa fa-twitter" aria-hidden="true"></i></a></li>
                        <li><a href="https://example.com/instagram"><i class="fa fa-instagram" aria-hidden="true"></i></a></li>
                      </ul>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  };

const sendEmail = async (to, subject, content) => {
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
    } catch (error) {
        console.error('Error sending email:', error);
    }
};

module.exports = { sendEmail };
