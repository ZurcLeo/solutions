/**
 * @fileoverview Template de e-mail para Magic Link de login.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 * Ticket: AUTH-PL-002
 * @module templates/emails/magicLink
 */
const wrapper = require('./wrapper');

/**
 * @param {Object} data
 * @param {string} data.userName         - Nome do usuário
 * @param {string} data.magicLinkUrl     - URL completa do magic link
 * @param {number} data.expiresInMinutes - Validade em minutos
 * @returns {string} HTML do e-mail
 */
module.exports = function magicLinkTemplate({ userName, magicLinkUrl, expiresInMinutes }) {
  const expiresLabel = expiresInMinutes === 1 ? '1 minuto' : `${expiresInMinutes} minutos`;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        Clique no botão abaixo para entrar na sua conta.<br>
        Este link é de uso único e expira em <strong style="color:${TEXT};">${escapeHtml(expiresLabel)}</strong>.
      </p>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:24px;">
        <a href="${escapeHtml(magicLinkUrl)}" class="btn" target="_blank" rel="noopener"
           style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:14px 32px; border-radius:10px; text-decoration:none; font-weight:600; font-size:16px;">
          Entrar na minha conta &rarr;
        </a>
      </div>

      <!-- Fallback link -->
      <div style="background:${P_SOFT}; border-radius:12px; padding:16px 20px; margin-bottom:32px; word-break:break-all;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          <strong style="color:${TEXT};">Não consegue clicar?</strong> Copie e cole este link no navegador:<br>
          <span style="color:${P};">${escapeHtml(magicLinkUrl)}</span>
        </p>
      </div>

      <!-- Nota de segurança -->
      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          <strong style="color:${TEXT};">Não foi você?</strong>
          Se você não solicitou este acesso, ignore este e-mail. Sua conta permanece protegida.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Acesse sua conta — ElosCloud',
    badgeText: 'Acesso',
    userName: userName || 'usuário',
    bodyContent,
    preheader: 'Clique no link para acessar sua conta ElosCloud.',
  });
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
