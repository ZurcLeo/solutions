const wrapper = require('./wrapper');

/**
 * Template for invitation reminder emails
 * @param {Object} data - Template data
 * @param {string} data.inviteId - ID of the invitation
 * @param {string} data.qrCodeBuffer - QR code as data URL
 * @param {string} data.senderName - Name of the sender
 * @param {string} data.friendName - Name of the friend being invited
 * @param {string} data.expiresAt - Expiration date formatted as string
 * @returns {string} HTML content
 */
module.exports = function(data) {
  // Handle content if passed as object (backwards compatibility)
  const content = data.content || {};
  const userName = data.friendName || content.friendName || 'Pessoa querida';
  const senderName = data.senderName || content.senderName || 'Um amigo';
  const inviteId = data.inviteId || content.inviteId || '';
  const qrCodeBuffer = data.qrCodeBuffer || '';
  const expiresAt = data.expiresAt || '';
  
  const BASE_URL = process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://eloscloud.com' : 'https://localhost:3000');
  
  const inviteLink = `${BASE_URL}/invite/validate/${inviteId}`;
  
  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px; font-size:16px; line-height:1.5;">
        <strong style="color:#1A1410;">${senderName}</strong> ainda está esperando por você na ElosCloud
        — e o convite tem prazo.
      </p>

      <!-- O que é a ElosCloud — resumo -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:32px;">
        <p style="margin-bottom:14px; font-size:15px; line-height:1.5; color:#1A1410;">
          Na ElosCloud você pode oferecer e contratar serviços, comprar de quem mora perto,
          poupar em grupo e construir uma reputação que abre portas.
        </p>
        <p style="font-size:14px; color:#4a3b32; font-style:italic;">
          Quem te convidou acredita em você — e confiança aqui tem valor real.
        </p>
      </div>

      <!-- Chamada para ação principal -->
      <div style="text-align:center;">
        <a href="${inviteLink}" class="btn">🌱 Aceitar Convite Agora</a>
        <p style="font-size:14px; color:#7A6F68; margin-top:8px;">Ou escaneie o QR Code abaixo</p>
        ${qrCodeBuffer ? `<img src="${qrCodeBuffer}" alt="QR Code" width="120" style="margin-top:8px; border-radius:12px; border: 1px solid #EFE4CF;">` : ''}
      </div>

      <!-- Informações do Convite -->
      <div style="margin:32px 0 24px; font-size:14px; color:#7A6F68;">
        ${expiresAt ? `<p><strong>Expira em:</strong> ${expiresAt}</p>` : ''}
        <p style="margin-top:8px; font-size:12px; line-height:1.4;">
          * Este convite é pessoal e seguro. Se não tem interesse, sinta-se à vontade para ignorar.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Lembrete de Convite 🌱',
    badgeText: '⌛ Seu convite ainda está esperando ⌛',
    userName,
    bodyContent,
    preheader: `Lembrete: ${senderName} ainda espera por você na ElosCloud — o convite tem prazo.`
  });
};
