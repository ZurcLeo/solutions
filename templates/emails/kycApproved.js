/**
 * Template de aprovação manual de KYC.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName - Nome do usuário
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function kycApprovedTemplate(data) {
  const { userName = 'Usuário' } = data;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const OK     = '#2E7D32';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        Temos uma ótima notícia — sua verificação de identidade foi
        <strong style="color:${OK};">aprovada com sucesso</strong>.
      </p>

      <!-- Status card — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:32px;">
        <span style="display:inline-block; background:${OK}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">&#10003; Verificado</span>
        <p style="font-family:${FONT}; font-size:18px; font-weight:700; color:${TEXT}; margin:0;">Nível CPF — Receita Federal</p>
      </div>

      <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0 0 32px;">
        Com a identidade verificada, você pode utilizar todos os recursos que exigem KYC,
        incluindo caixinhas, empréstimos e outras operações financeiras.
      </p>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${APP_URL}/configuracoes" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Ver status da minha conta &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas? Fale com nossa equipe em
          <a href="${APP_URL}/suporte" style="color:${P}; text-decoration:none;">eloscloud.com/suporte</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Identidade verificada — ElosCloud',
    badgeText: 'Verificação KYC',
    userName,
    bodyContent,
    preheader: 'Sua verificação de identidade foi aprovada! Todos os recursos estão liberados.',
  });
};
