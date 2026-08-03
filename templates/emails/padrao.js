const wrapper = require('./wrapper');

/**
 * Standard/default email template
 * @param {Object} data - Template data
 * @param {string} data.subject - Email subject
 * @param {string} data.content - Email content (can be HTML)
 * @param {string} data.userName - User name
 * @returns {string} HTML content
 */
const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function(data) {
  const subject = data.subject || 'Notificação ElosCloud';
  const content = data.content || '';
  const userName = data.userName || 'Pessoa querida';
  
  const bodyContent = `
      <div style="color:#1A1410; font-size:16px; line-height:1.6; margin-bottom:24px;">
        ${content}
      </div>

      <div style="text-align:center; margin-top:32px;">
        <a href="${APP_URL}/dashboard" class="btn">🌿 Ir para a Plataforma</a>
      </div>
  `;

  return wrapper({
    title: subject,
    badgeText: '🔔 Atualização de Conta 🔔',
    userName,
    bodyContent,
    preheader: subject
  });
};
