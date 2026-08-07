/**
 * Template de rejeição de loja no Mercado Local ElosCloud.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName        - Nome do usuário
 * @param {string} data.businessName    - Nome da empresa/loja
 * @param {string} [data.reason]        - Motivo da rejeição (opcional)
 * @param {string} [data.supportUrl]    - URL de suporte para contestar (opcional)
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function sellerRejectedTemplate(data) {
  const {
    userName     = 'Usuário',
    businessName = 'sua loja',
    reason       = '',
    supportUrl   = `${APP_URL}/ajuda/chamados`,
  } = data;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const WARN   = '#E67E22';
  const W_SOFT = '#FDF2E9';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        Agradecemos seu interesse no Mercado Local. Após análise,
        identificamos alguns pontos que precisam de ajuste antes de
        ativarmos a loja.
      </p>

      <!-- Loja não aprovada — §08 card style -->
      <div style="background:${W_SOFT}; border:1.5px solid ${WARN}; border-radius:12px; padding:24px; text-align:center; margin-bottom:32px;">
        <span style="display:inline-block; background:${WARN}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">Não aprovada desta vez</span>
        <p style="font-family:${FONT}; font-size:20px; font-weight:700; color:${TEXT}; margin:0;">${businessName}</p>
      </div>

      ${reason ? `
      <!-- Motivo — §08 card style -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:20px 24px; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${WARN}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Motivo</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0;">${reason}</p>
      </div>
      ` : ''}

      <!-- Próximos passos — §12 stepper style -->
      <p style="font-family:${FONT}; font-size:16px; font-weight:700; color:${TEXT}; margin:0 0 16px;">
        O que você pode fazer agora:
      </p>

      <table role="presentation" style="width:100%; border-collapse:collapse; margin-bottom:32px;">
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 16px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">1</div>
          </td>
          <td style="vertical-align:top; padding:0 0 16px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Fale com o suporte</strong> — nossa equipe pode explicar com mais detalhes o que precisa ser ajustado.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 16px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">2</div>
          </td>
          <td style="vertical-align:top; padding:0 0 16px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Corrija as informações</strong> — após os ajustes necessários, você pode enviar uma nova solicitação.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 0 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">3</div>
          </td>
          <td style="vertical-align:top; padding:0;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Tente novamente</strong> — acesse
              <a href="${APP_URL}/mercado/vendedor" style="color:${P}; text-decoration:none;">Mercado &rarr; Abra sua loja</a>
              e submeta os dados atualizados.
            </p>
          </td>
        </tr>
      </table>

      <!-- CTAs — §05 button primary + outline -->
      <div style="text-align:center; margin-bottom:24px;">
        <a href="${supportUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Falar com o suporte &rarr;</a>
      </div>
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${APP_URL}/mercado/vendedor" class="btn-outline" style="display:inline-block; background:transparent; color:${P} !important; padding:10px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px; border:1.5px solid ${P};">Tentar novamente</a>
      </div>

      <!-- Reassurance -->
      <div style="background:${P_SOFT}; border-radius:12px; padding:20px 24px; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0;">
          <strong style="color:${TEXT};">Não desanime!</strong> A análise garante que o Mercado Local
          seja seguro e de qualidade para toda a comunidade. Estamos aqui para ajudar.
        </p>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Acredita que foi um engano? Fale conosco em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Atualização sobre sua loja — ElosCloud',
    badgeText: 'Mercado Local',
    userName,
    bodyContent,
    preheader: `Sua solicitação para "${businessName}" precisa de ajustes. Veja como proceder.`,
  });
};
