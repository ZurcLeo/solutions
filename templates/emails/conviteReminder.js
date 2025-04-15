// templates/emails/conviteReminder.js

/**
 * Template for invitation reminder emails
 * @param {Object} data - Template data
 * @param {string} data.inviteId - ID of the invitation
 * @param {string} data.qrCodeBuffer - QR code as data URL
 * @param {string} data.senderName - Name of the sender
 * @param {string} data.friendName - Name of the friend being invited
 * @returns {string} HTML content
 */
module.exports = function(data) {
    // Extract data with fallbacks
    const inviteId = data.inviteId || '';
    const qrCodeBuffer = data.qrCodeBuffer || '';
    const senderName = data.senderName || 'Amigo';
    const friendName = data.friendName || 'Amigo';
    
    // Backwards compatibility for content provided directly
    const content = data.content || '';
    if (content && typeof content === 'object' && content.friendName && content.senderName && content.inviteId) {
      return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Lembrete de Convite - ElosCloud</title>
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
            background-color: #fd8c5e;
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
                    Lembrete de Convite - ElosCloud
                  </td>
                </tr>
                <tr>
                  <td class="email-body">
                    <p>Olá ${content.friendName},</p>
                    <p>Você recebeu um convite de <strong>${content.senderName}</strong> para se juntar ao ElosCloud!</p>
                    <p>Não perca a oportunidade de fazer parte da nossa rede. Clique no botão abaixo para aceitar o convite:</p>
                    <a href="https://eloscloud.com/invite/validate/${content.inviteId}" class="cta-button">Aceitar Convite</a>
                    <p class="highlight">Este convite é válido por tempo limitado. Não perca!</p>
                    <p>Atenciosamente,</p>
                    <p>Equipe ElosCloud</p>
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
                      Ao aceitar o convite, alguns dados serão compartilhados com o remetente. Consulte os termos.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>`;
    }
    
    // Standard template
    return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Lembrete de Convite - ElosCloud</title>
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
          background-color: #fd8c5e;
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
                  Lembrete de Convite - ElosCloud
                </td>
              </tr>
              <tr>
                <td class="email-body">
                  <p>Olá ${friendName},</p>
                  <p>Você recebeu um convite de <strong>${senderName}</strong> para se juntar ao ElosCloud!</p>
                  <p>Não perca a oportunidade de fazer parte da nossa rede. Clique no botão abaixo para aceitar o convite:</p>
                  <a href="https://eloscloud.com/invite/validate/${inviteId}" class="cta-button">Aceitar Convite</a>
                  <p class="highlight">Este convite é válido por tempo limitado. Não perca!</p>
                  <p>Você também pode escanear o QR Code abaixo:</p>
                  <div style="text-align: center;">
                    ${qrCodeBuffer ? `<img src="${qrCodeBuffer}" alt="QR Code" width="150" height="150" style="display: block; margin: auto;" />` : ''}
                  </div>
                  <p>Atenciosamente,</p>
                  <p>Equipe ElosCloud</p>
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
                    Ao aceitar o convite, alguns dados serão compartilhados com o remetente. Consulte os termos.
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