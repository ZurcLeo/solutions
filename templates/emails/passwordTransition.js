/**
 * @fileoverview Template de e-mail de transição para autenticação sem senha.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 * Ticket: AUTH-PL-006
 * @module templates/emails/passwordTransition
 */
const wrapper = require('./wrapper');

/**
 * @param {Object} data
 * @param {string} data.userName        - Nome do usuário
 * @param {string} data.magicLinkUrl    - URL do magic link para acesso imediato
 * @param {string} data.cutoffDate      - Data limite para senhas (ex: "27 de agosto de 2026")
 * @returns {string} HTML do e-mail
 */
module.exports = function passwordTransitionTemplate({ userName, magicLinkUrl, cutoffDate }) {
  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const cutoffMessage = cutoffDate
    ? `Sua senha atual continuará funcionando até <strong style="color:${TEXT};">${escapeHtml(cutoffDate)}</strong>. Depois disso, apenas os métodos acima estarão disponíveis.`
    : 'Sua senha atual continuará funcionando por mais 30 dias. Depois, apenas os métodos acima estarão disponíveis.';

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 24px; font-size:16px; line-height:1.7;">
        A ElosCloud agora usa <strong style="color:${TEXT};">acesso sem senha</strong>.
        Você não precisa mais lembrar ou digitar senhas para entrar.
      </p>

      <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.7; margin:0 0 16px;">
        Na próxima vez que acessar, escolha um destes métodos:
      </p>

      <!-- Métodos de acesso -->
      <div style="background:${P_SOFT}; border-radius:12px; padding:16px 20px; margin-bottom:12px;">
        <p style="font-family:${FONT}; font-size:15px; font-weight:700; color:${TEXT}; margin:0 0 4px;">Biometria (Passkey)</p>
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">Use impressão digital ou reconhecimento facial. O mais rápido.</p>
      </div>

      <div style="background:${P_SOFT}; border-radius:12px; padding:16px 20px; margin-bottom:12px;">
        <p style="font-family:${FONT}; font-size:15px; font-weight:700; color:${TEXT}; margin:0 0 4px;">Link por e-mail</p>
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">Receba um link de acesso direto no seu e-mail.</p>
      </div>

      <div style="background:${P_SOFT}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:15px; font-weight:700; color:${TEXT}; margin:0 0 4px;">Código de acesso</p>
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">Receba um código temporário de 8 dígitos por e-mail.</p>
      </div>

      <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.7; margin:0 0 32px;">
        ${cutoffMessage}
      </p>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:16px;">
        <a href="${escapeHtml(magicLinkUrl)}" class="btn" target="_blank" rel="noopener"
           style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:14px 32px; border-radius:10px; text-decoration:none; font-weight:600; font-size:16px;">
          Entrar agora sem senha &rarr;
        </a>
      </div>

      <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; text-align:center; margin:0;">
        Este link expira em <strong>15 minutos</strong>.
      </p>
  `;

  return wrapper({
    title: 'Sua conta ficou mais segura — ElosCloud',
    badgeText: 'Segurança',
    userName: userName || 'usuário',
    bodyContent,
    preheader: 'A ElosCloud agora usa acesso sem senha. Veja como entrar na sua conta.',
  });
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
