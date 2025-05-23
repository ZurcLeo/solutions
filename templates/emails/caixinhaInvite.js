// templates/emails/caixinhaInvite.js

/**
 * Template para convites de caixinha
 * @param {Object} data - Dados do template
 * @returns {string} Conteúdo HTML
 */
module.exports = function(data) {
    // Extrair dados com fallbacks
    const caixinhaNome = data.caixinhaNome || 'Caixinha';
    const caixinhaDescricao = data.caixinhaDescricao || '';
    const contribuicaoMensal = data.contribuicaoMensal || 0;
    const senderName = data.senderName || 'Um membro';
    const senderPhotoURL = data.senderPhotoURL || 'https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/default-profile.png';
    const targetName = data.targetName || 'Amigo';
    const message = data.message || '';
    const inviteLink = data.inviteLink || '#';
    const expirationDate = data.expirationDate || 'em 7 dias';
    
    return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Convite para Caixinha ${caixinhaNome}</title>
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
        .caixinha-details {
          background-color: #f9f9f9;
          border-radius: 8px;
          padding: 15px;
          margin: 15px 0;
          border-left: 4px solid #345C72;
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
        .sender-info {
          display: flex;
          align-items: center;
          margin-bottom: 15px;
        }
        .sender-avatar {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          margin-right: 15px;
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
                  Convite para Caixinha
                </td>
              </tr>
              <tr>
                <td class="email-body">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td align="left" valign="top" style="padding: 10px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" width="60">
                              <img src="${senderPhotoURL}" alt="${senderName}" class="sender-avatar" style="width: 50px; height: 50px; border-radius: 50%; margin-right: 15px;">
                            </td>
                            <td valign="middle">
                              <p style="margin: 0;"><strong>${senderName}</strong> convidou você para participar da Caixinha:</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <div class="caixinha-details" style="background-color: #f9f9f9; border-radius: 8px; padding: 15px; margin: 15px 0; border-left: 4px solid #345C72; text-align: left;">
                          <h3 style="margin-top: 0; color: #345C72;">${caixinhaNome}</h3>
                          ${caixinhaDescricao ? `<p>${caixinhaDescricao}</p>` : ''}
                          <p><strong>Contribuição mensal:</strong> R$ ${contribuicaoMensal.toFixed(2)}</p>
                        </div>
                      </td>
                    </tr>
                    ${message ? 
                    `<tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <div style="background-color: #f0f0f0; border-radius: 8px; padding: 15px; margin: 5px 0; font-style: italic;">
                          "${message}"
                        </div>
                      </td>
                    </tr>` : ''}
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <p style="margin: 20px 0 10px 0;">Para participar, clique no botão abaixo:</p>
                        <a href="${inviteLink}" class="cta-button" style="display: block; width: 80%; margin: 20px auto; padding: 12px; background-color: #fd8c5e; color: white; text-align: center; text-decoration: none; border-radius: 6px; font-size: 18px;">
                          Aceitar Convite
                        </a>
                        <p class="highlight" style="background-color: #ffcc00; padding: 10px; border-radius: 5px; text-align: center; font-weight: bold; margin: 20px 0;">
                          Este convite expira ${expirationDate}
                        </p>
                      </td>
                    </tr>
                  </table>
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
                    Ao aceitar o convite, alguns dados serão compartilhados. Consulte os termos para mais informações.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
  };