const wrapper = require('./wrapper');

/**
 * Template for invitation emails
 * @param {Object} data - Template data
 * @param {string} data.inviteId - ID of the invitation
 * @param {string} data.qrCodeBuffer - QR code as data URL
 * @param {string} data.senderName - Name of the sender
 * @param {string} data.friendName - Name of the friend being invited
 * @param {string} data.expiresAt - Expiration date formatted as string
 * @returns {string} HTML content
 */
module.exports = function(data) {
  const userName = data.friendName || 'Pessoa querida';
  const senderName = data.senderName || 'Um amigo';
  const inviteId = data.inviteId || '';
  const qrCodeBuffer = data.qrCodeBuffer || '';
  const expiresAt = data.expiresAt || '';
  
  // Use production URL or localhost based on environment
  const BASE_URL = process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://eloscloud.com' : 'https://localhost:3000');
  
  const inviteLink = `${BASE_URL}/invite/validate/${inviteId}`;
  
  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px; font-size:16px; line-height:1.5;">
        <strong style="color:#1A1410;">${senderName}</strong> te convidou para fazer parte da ElosCloud
        — e convites aqui têm peso: quem te trouxe acredita em você.
      </p>

      <!-- O que é a ElosCloud -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:32px;">
        <p style="margin-bottom:16px; font-size:17px; font-weight:700; color:#1A1410;">
          O que é a ElosCloud?
        </p>
        <p style="margin-bottom:14px; font-size:15px; line-height:1.5; color:#1A1410;">
          É o bairro com endereço digital. Num só lugar você pode:
        </p>
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr><td style="padding:6px 0; font-size:14px; color:#4a3b32; line-height:1.4;">
            🛠️ Contratar e oferecer serviços de quem mora perto
          </td></tr>
          <tr><td style="padding:6px 0; font-size:14px; color:#4a3b32; line-height:1.4;">
            🛒 Pedir comida, produtos e entregas da sua região
          </td></tr>
          <tr><td style="padding:6px 0; font-size:14px; color:#4a3b32; line-height:1.4;">
            💰 Poupar junto com amigos e família em caixinhas coletivas
          </td></tr>
          <tr><td style="padding:6px 0; font-size:14px; color:#4a3b32; line-height:1.4;">
            🏠 Hospedar ou se hospedar com quem você confia
          </td></tr>
          <tr><td style="padding:6px 0; font-size:14px; color:#4a3b32; line-height:1.4;">
            ⭐ Construir uma reputação que abre portas — no bairro e além
          </td></tr>
        </table>
        <p style="margin-top:14px; font-size:14px; color:#4a3b32; font-style:italic;">
          Quanto mais você participa, mais sua confiança cresce. E confiança aqui tem valor real.
        </p>
      </div>

      <!-- Chamada para ação principal -->
      <div style="text-align:center;">
        <a href="${inviteLink}" class="btn">🌱 Aceitar Convite</a>
        <p style="font-size:14px; color:#7A6F68; margin-top:8px;">Ou escaneie o QR Code abaixo</p>
        ${qrCodeBuffer ? `<img src="${qrCodeBuffer}" alt="QR Code" width="120" style="margin-top:8px; border-radius:12px; border: 1px solid #EFE4CF;">` : ''}
      </div>

      <!-- Informações do Convite -->
      <div style="margin:32px 0 24px; font-size:14px; color:#7A6F68;">
        ${expiresAt ? `<p><strong>Expira em:</strong> ${expiresAt}</p>` : ''}
        <p style="margin-top:8px; font-size:12px; line-height:1.4;">
          * Seus dados só são compartilhados com o remetente após o seu registro bem-sucedido.
        </p>
      </div>

      <!-- Informações de segurança -->
      <div style="font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px; margin-bottom:16px;">
        <strong>🛡️ Segurança em primeiro lugar</strong><br>
        Criptografia AES‑256, transparência e responsabilidade em cada etapa.
      </div>
  `;

  return wrapper({
    title: 'Você recebeu um convite 🌱',
    badgeText: '✨ Um convite especial para você ✨',
    userName,
    bodyContent,
    preheader: `${senderName} te convidou para a ElosCloud — e convites aqui têm peso.`
  });
};
