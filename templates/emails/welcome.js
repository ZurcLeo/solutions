// templates/emails/welcome.js

/**
 * Template for welcome emails when a user completes registration
 * @param {Object} data - Template data
 * @param {string} data.nome - User's name
 * @param {string} data.email - User's email
 * @returns {string} HTML content
 */
module.exports = function(data) {
    // Extract data with fallbacks
    const nome = data.nome || 'Novo Usuário';
    const email = data.email || '';
    const logoURL = process.env.LOGO_URL || "https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/logo.png";
    
    return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bem-vindo à ElosCloud</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background-color: #f4f4f4;
          margin: 0;
          padding: 0;
          color: #333333;
        }
        .email-container {
          max-width: 600px;
          margin: auto;
          background-color: #ffffff;
          border-radius: 8px;
          box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        .email-header {
          background-color: #345C72;
          color: white;
          text-align: center;
          padding: 20px;
          font-size: 24px;
          font-weight: bold;
        }
        .email-body {
          padding: 20px;
          font-size: 16px;
          color: #333333;
        }
        .email-body p {
          margin: 10px 0;
        }
        .cta-button {
          display: block;
          width: 80%;
          margin: 20px auto;
          padding: 12px;
          background-color: #007bff;
          color: white;
          text-align: center;
          text-decoration: none;
          border-radius: 6px;
          font-size: 18px;
        }
        .highlight {
          background-color: #ffcc00;
          padding: 10px;
          border-radius: 5px;
          text-align: center;
          font-weight: bold;
        }
        .steps-container {
          background-color: #f9f9f9;
          border-radius: 8px;
          padding: 15px;
          margin: 15px 0;
        }
        .step-item {
          padding: 10px;
          border-bottom: 1px solid #eeeeee;
        }
        .step-item:last-child {
          border-bottom: none;
        }
        .step-title {
          font-weight: bold;
          font-size: 18px;
          margin-bottom: 5px;
        }
        .step-description {
          font-size: 16px;
          color: #555555;
        }
        .email-footer {
          background-color: #333333;
          color: white;
          text-align: center;
          padding: 15px;
          font-size: 14px;
        }
        .email-footer a {
          color: #ffffff;
          text-decoration: underline;
          margin: 0 5px;
        }
        @media screen and (max-width: 600px) {
          .email-container {
            width: 100% !important;
          }
          .email-body {
            padding: 10px !important;
          }
        }
      </style>
    </head>
    <body>
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" valign="top">
            <table class="email-container" border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td class="email-header">
                  Bem-vindo à ElosCloud!
                </td>
              </tr>
              <tr>
                <td class="email-body">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
                          <tr>
                            <td align="left" valign="top" style="padding: 10px;">
                              <img src="${logoURL}" alt="ElosCloud" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
                            </td>
                            <td align="left" valign="top">
                              <p style="margin: 0;"><strong>Bem-vindo à ElosCloud!</strong></p>
                              <p style="margin: 0; font-size: 20px;">Sua conta foi criada com sucesso.</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <div class="highlight" style="background-color: #ffcc00; padding: 10px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 20px; font-weight: bold; color: #333333;">
                          Você recebeu 5.000 ElosCoins ao se cadastrar!
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" valign="top" style="padding: 10px;">
                        <p style="margin: 0;"><strong>Próximos passos:</strong></p>
                        <div class="steps-container">
                          <div class="step-item">
                            <p class="step-title">&#10112; Complete seu Perfil</p>
                            <p class="step-description">Adicione informações e uma foto de perfil</p>
                          </div>
                          <div class="step-item">
                            <p class="step-title">&#10113; Realize postagens</p>
                            <p class="step-description">Compartilhe novidades com seus amigos</p>
                          </div>
                          <div class="step-item">
                            <p class="step-title">&#10114; Crie, participe e gerencie caixinhas</p>
                            <p class="step-description">Administre suas caixinhas de forma eficiente</p>
                          </div>
                          <div class="step-item">
                            <p class="step-title">&#10115; Adicione formas de pagamento e recebimento</p>
                            <p class="step-description">Configure métodos de pagamento e recebimento</p>
                          </div>
                          <div class="step-item">
                            <p class="step-title">&#10116; Convide seus amigos</p>
                            <p class="step-description">Traga seus amigos para a ElosCloud</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </table>
                  <p style="text-align: center; margin-top: 20px;">Clique no botão abaixo para acessar sua conta!</p>
                  <a href="https://eloscloud.com/login" class="cta-button">VALIDAR MINHA CONTA E ENTRAR</a>
                </td>
              </tr>
              <tr>
                <td class="email-footer">
                  Copyright &copy; ${new Date().getFullYear()} | ElosCloud
                  <br>
                  <a href="https://eloscloud.com">Visitar ElosCloud</a> |
                  <a href="https://eloscloud.com/terms">Termos de Uso</a> |
                  <a href="https://eloscloud.com/privacy">Política de Privacidade</a>
                  <p style="font-size: 12px; margin: 10px 0 0 0;">
                    Este e-mail é automático. Por favor, não responda.
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