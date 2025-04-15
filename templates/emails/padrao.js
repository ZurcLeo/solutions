// templates/emails/padrao.js

/**
 * Standard/default email template
 * @param {Object} data - Template data
 * @param {string} data.subject - Email subject
 * @param {string} data.content - Email content (can be HTML)
 * @returns {string} HTML content
 */
module.exports = function(data) {
    // Extract data with fallbacks
    const subject = data.subject || '';
    const content = data.content || '';
    
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
            padding: 20px;
            position: relative;
          }
          .email-header {
            background-color: #345C72;
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 26px;
            font-weight: bold;
          }
          .email-body {
            padding: 20px;
            font-size: 16px;
            color: #333333;
            line-height: 1.6;
            position: relative;
            z-index: 1;
          }
          .email-body a {
            color: #007bff;
            text-decoration: underline;
          }
          .email-highlight {
            background-color: #ffcc00;
            padding: 10px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
            font-size: 20px;
            font-weight: bold;
            color: #333333;
          }
          .email-footer {
            background-color: #333333;
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 14px;
          }
          .email-background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('https://imgur.com/4kHNVXA.png');
            background-size: cover;
            background-position: center;
            opacity: 0.3;
            z-index: 0;
          }
          .email-button {
            display: block;
            width: 200px;
            margin: 20px auto;
            padding: 10px;
            background-color: #345C72;
            color: white;
            text-align: center;
            text-decoration: none;
            border-radius: 5px;
            font-size: 16px;
          }
          @media screen and (max-width: 600px) {
            .email-container {
              width: 100% !important;
              margin: auto;
              border-radius: 0;
            }
            .email-header, .email-body, .email-footer {
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
          <div class="email-background"></div>
          <div class="email-header">
            ${subject}
          </div>
          <div class="email-body">
            ${content}
          </div>
          <div class="email-footer">
            Copyright &copy; ${new Date().getFullYear()} | ElosCloud
            <br>
            <a href="https://eloscloud.com" style="color: #ffffff; text-decoration: underline;">Visitar ElosCloud</a> |
            <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
            <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
            <p style="margin: 10px 0 0 0; font-size: 12px;">
              Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
            </p>
          </div>
        </div>
      </body>
    </html>
    `;
  };