// templates/emails/convite.js

/**
 * Template for invitation emails
 * @param {Object} data - Template data
 * @param {string} data.inviteId - ID of the invitation
 * @param {string} data.qrCodeBuffer - QR code as data URL
 * @param {string} data.maskedHashedInviteId - Masked invite ID hash
 * @param {string} data.senderName - Name of the sender
 * @param {string} data.senderPhotoURL - Profile picture URL of the sender
 * @param {string} data.friendName - Name of the friend being invited
 * @param {string} data.expiresAt - Expiration date formatted as string
 * @returns {string} HTML content
 */
module.exports = function(data) {
    // Extract data with fallbacks
    const inviteId = data.inviteId || '';
    const qrCodeBuffer = data.qrCodeBuffer || '';
    const maskedHashedInviteId = data.maskedHashedInviteId || '';
    const senderName = data.senderName || 'Amigo';
    const senderPhotoURL = data.senderPhotoURL || 'https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/default-profile.png';
    const friendName = data.friendName || 'Amigo';
    const friendFoto = data.friendFoto || 'https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/default-profile.png';
    const expiresAt = data.expiresAt || '';
    
    // Backwards compatibility for content provided directly
    const content = data.content || '';
    if (content) {
      return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bilhete de Embarque - ElosCloud</title>
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
            background-color: rgba(255, 255, 255, 0.95);
            border: 1px solid #dddddd;
            border-radius: 8px;
            overflow: hidden;
            padding: 20px;
          }
          .email-header {
            background-color: #345C72;
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 26px;
            font-weight: bold;
          }
          .email-content {
            padding: 20px;
            color: #333333;
          }
          .email-footer {
            background-color: #333333;
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 14px;
          }
          .highlight {
            background-color: #ffcc00;
            padding: 10px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
            font-size: 20px;
            font-weight: bold;
            color: #333333;
          }
          .button {
            display: block;
            width: 200px;
            margin: 20px auto;
            padding: 10px;
            background-color: #fd8c5e;
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
            .email-header, .email-content, .email-footer {
              padding: 10px !important;
            }
          }
        </style>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Cabin:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
      </head>
      <body>
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" valign="top" style="padding: 10px;">
              <table class="email-container" border="0" cellspacing="0" cellpadding="0" style="background: url('https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/emailPictures/background_convite_eloscloud.png?GoogleAccessId=firebase-adminsdk-xr3qw%40elossolucoescloud-1804e.iam.gserviceaccount.com&Expires=16447014000&Signature=URAP17re0vhIg8sObSblsd%2FVzk0OQ3lNB67LT6fPqWgZeMFjMcrqfQCs6tAO%2BPaxOB8Iu7DHjLcrDVHc%2Fw0cU%2F6Nw1zC5ay5d%2B993OwhjDLgWW6LIX086xaIHMXFxF8%2FBBUKSiTpFcSHMKfkSc6VY6XH%2FQcBhLzbQElxNO8RvHNugWFZxpXKtYSI1srP0daUOEr2diENDqrfup%2FcqhOC7C%2FtYPoz9qClmAHqHYjJ9ZeFqorh179S32FmuM7tBROQ2cANgNbX%2Fu08%2FgjNEX8SB1eCcCFRDPZ%2B1%2FQqGPu1kJ33Gf1sA5ZUHS5lWzgyxRkOBmcJ2504x7iRUCHZT9OE%2BA%3D%3D'); background-size: cover; opacity: 0.9; background-position: center; color: white;">
                <tr>
                  <td align="center" valign="top" class="email-header">
                    BILHETE DE EMBARQUE
                  </td>
                </tr>
                <tr>
                  <td class="email-content">
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td class="email-footer">
                    Copyright &copy; ${new Date().getFullYear()} | ElosCloud
                    <br>
                    <a href="https://eloscloud.com/view-invite" style="color: #ffffff; text-decoration: underline;">Visualizar Convite no Site</a> |
                    <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
                    <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
                    <p style="margin: 10px 0 0 0; font-size: 12px;">
                      Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
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
 
    // Standard template when all data is provided
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bilhete de Embarque - ElosCloud</title>
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
          background-color: rgba(255, 255, 255, 0.95);
          border: 1px solid #dddddd;
          border-radius: 8px;
          overflow: hidden;
          padding: 20px;
        }
        .email-header {
          background-color: #345C72;
          color: white;
          text-align: center;
          padding: 15px;
          font-size: 26px;
          font-weight: bold;
        }
        .email-content {
          padding: 20px;
          color: #333333;
        }
        .email-footer {
          background-color: #333333;
          color: white;
          text-align: center;
          padding: 15px;
          font-size: 14px;
        }
        .highlight {
          background-color: #ffcc00;
          padding: 10px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: center;
          font-size: 20px;
          font-weight: bold;
          color: #333333;
        }
        .button {
          display: block;
          width: 200px;
          margin: 20px auto;
          padding: 10px;
          background-color: #fd8c5e;
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
          .email-header, .email-content, .email-footer {
            padding: 10px !important;
          }
        }
      </style>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Cabin:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
    </head>
    <body>
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" valign="top" style="padding: 10px;">
            <table class="email-container" border="0" cellspacing="0" cellpadding="0" style="background: url('https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/emailPictures/background_convite_eloscloud.png?GoogleAccessId=firebase-adminsdk-xr3qw%40elossolucoescloud-1804e.iam.gserviceaccount.com&Expires=16447014000&Signature=URAP17re0vhIg8sObSblsd%2FVzk0OQ3lNB67LT6fPqWgZeMFjMcrqfQCs6tAO%2BPaxOB8Iu7DHjLcrDVHc%2Fw0cU%2F6Nw1zC5ay5d%2B993OwhjDLgWW6LIX086xaIHMXFxF8%2FBBUKSiTpFcSHMKfkSc6VY6XH%2FQcBhLzbQElxNO8RvHNugWFZxpXKtYSI1srP0daUOEr2diENDqrfup%2FcqhOC7C%2FtYPoz9qClmAHqHYjJ9ZeFqorh179S32FmuM7tBROQ2cANgNbX%2Fu08%2FgjNEX8SB1eCcCFRDPZ%2B1%2FQqGPu1kJ33Gf1sA5ZUHS5lWzgyxRkOBmcJ2504x7iRUCHZT9OE%2BA%3D%3D'); background-size: cover; opacity: 0.9; background-position: center; color: white;">
              <tr>
                <td align="center" valign="top" class="email-header">
                  BILHETE DE EMBARQUE
                </td>
              </tr>
              <tr>
                <td class="email-content">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
                          <tr>
                            <td align="left" valign="top" style="padding: 10px;">
                              <img src="${senderPhotoURL}" alt="${senderName}" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
                            </td>
                            <td align="left" valign="top">
                              <p style="margin: 0;"><strong>Enviado Por:</strong></p>
                              <p style="margin: 0; font-size: 20px;">${senderName}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
                          <tr>
                            <td align="left" valign="top" style="padding: 10px;">
                              <img src="${friendFoto}" alt="${friendName}" width="60" height="60" style="border-radius: 50%; object-fit: cover; margin-right: 15px; display: block;" />
                            </td>
                            <td align="left" valign="top">
                              <p style="margin: 0;"><strong>Convite para:</strong></p>
                              <p style="margin: 0; font-size: 20px;">${friendName}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; color: rgba(0, 0, 255, 0.5)">
                          <tr>
                            <td>
                              <p><strong>DESTINO:</strong> ELOSCLOUD</p>
                              <p><strong>PASSAGEIRO:</strong> ${friendName}</p>
                              <p><strong>CREDENCIAL:</strong> ${maskedHashedInviteId}</p>
                              <p><strong>GERADO EM:</strong> ${new Date().toLocaleDateString()}</p>
                              <p><strong>EXPIRA EM:</strong> ${expiresAt}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <div class="highlight" style="background-color: #ffcc00; padding: 10px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 20px; font-weight: bold; color: #333333;">
                          Instruções
                        </div>
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px;">
                          <tr>
                            <td align="left" valign="top" style="padding: 10px;">
                              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10112; Aceitar</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Clique no botão Aceitar Convite</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10113; Validar E-mail</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Informe o e-mail que você recebeu o convite</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10114; Validar Nome</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Informe o seu nome exatamente como neste convite</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10115; Validar Convite</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Clique no botão Validar Convite</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10116; Registrar</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Na página de registro escolha sua forma preferida</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10117; Confirmar Registro</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Clique no botão Criar Conta</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td width="20%" align="left" valign="top">
                                    <p style="margin: 0; font-size: 18px;"><strong>&#10118; Boas-vindas</strong></p>
                                    <p style="margin: 0; font-size: 16px;">Parabéns! Um e-mail de boas-vindas será enviado</p>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <a href="https://eloscloud.com/invite/validate/${inviteId}" style="display: block; width: 200px; margin: 20px auto; padding: 10px; background-color: #fd8c5e; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-size: 16px;">
                          Aceitar Convite
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <img src="${qrCodeBuffer}" alt="QR Code" width="150" height="150" style="display: block; margin: auto;" />
                      </td>
                    </tr>
                    <tr>
                      <td align="center" valign="top" style="padding: 10px;">
                        <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
                          Clique no botão ou escaneie o QRCode para validar o seu convite e se registrar!
                        </p>
                        <p style="background-color: rgba(255, 255, 255, 0.7); padding: 15px; border-radius: 8px; text-align: center; font-size: 16px; color: #333;">
                          Não se interessou? Sem problemas, basta ignorar este e-mail.
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
                  <a href="https://eloscloud.com/view-invite" style="color: #ffffff; text-decoration: underline;">Visualizar Convite no Site</a> |
                  <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
                  <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
                  <p style="margin: 10px 0 0 0; font-size: 12px;">
                    Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>`
  };