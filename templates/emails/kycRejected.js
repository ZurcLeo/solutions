/**
 * Template de rejeição manual de KYC.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName - Nome do usuário
 * @param {string} data.reason   - Motivo da rejeição
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function kycRejectedTemplate(data) {
  const {
    userName = 'Usuário',
    reason   = 'Não foi possível concluir a verificação com as informações fornecidas.',
  } = data;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const WARN   = '#E67E22';
  const W_SOFT = '#FDF2E9';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        Nossa equipe analisou sua solicitação de verificação de identidade e,
        infelizmente, não foi possível concluí-la neste momento.
      </p>

      <!-- Motivo — §08 card style -->
      <div style="background:${W_SOFT}; border:1.5px solid ${WARN}; border-radius:12px; padding:20px 24px; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${WARN}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Motivo</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0;">${reason}</p>
      </div>

      <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0 0 32px;">
        Você pode tentar novamente acessando a aba <strong style="color:${TEXT};">Segurança</strong> nas configurações da sua conta.
        Se precisar de ajuda, nossa equipe de suporte está disponível.
      </p>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${APP_URL}/ajuda/chamados" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Falar com o suporte &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Acesse suas configurações em
          <a href="${APP_URL}/configuracoes" style="color:${P}; text-decoration:none;">eloscloud.com/configuracoes</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Atualização sobre sua verificação — ElosCloud',
    badgeText: 'Verificação KYC',
    userName,
    bodyContent,
    preheader: 'Sua verificação de identidade precisa de ajustes. Veja como proceder.',
  });
};
