/**
 * Template de aprovação de loja no Mercado Local ElosCloud.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName        - Nome do vendedor
 * @param {string} data.businessName    - Nome da empresa/loja aprovada
 * @param {string} [data.category]      - Categoria da loja
 * @param {string} [data.dashboardUrl]  - URL do painel do vendedor
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function sellerApprovedTemplate(data) {
  const {
    userName     = 'Vendedor',
    businessName = 'sua loja',
    category     = '',
    dashboardUrl = `${APP_URL}/mercado/vendedor`,
  } = data;

  const categoryLabels = {
    alimentacao: 'Alimentação',
    servicos:    'Serviços',
    produtos:    'Produtos',
    obra:        'Obra / Construção',
    evento:      'Evento',
    outros:      'Outros',
  };
  const categoryLabel = categoryLabels[category] || category || '';

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
        Temos uma ótima notícia — sua loja foi
        <strong style="color:${OK};">aprovada</strong>
        e já está visível para a comunidade.
      </p>

      <!-- Loja aprovada — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:32px;">
        <span style="display:inline-block; background:${OK}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">✓ Aprovada</span>
        <p style="font-family:${FONT}; font-size:20px; font-weight:700; color:${TEXT}; margin:0 0 4px;">${businessName}</p>
        ${categoryLabel ? `<p style="font-family:${FONT}; font-size:14px; color:${P}; margin:0;">${categoryLabel}</p>` : ''}
      </div>

      <!-- Próximos passos — §12 stepper style -->
      <p style="font-family:${FONT}; font-size:16px; font-weight:700; color:${TEXT}; margin:0 0 16px;">
        Próximos passos para começar a vender:
      </p>

      <table role="presentation" style="width:100%; border-collapse:collapse; margin-bottom:32px;">
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 16px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;"">1</div>
          </td>
          <td style="vertical-align:top; padding:0 0 16px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Cadastre seus produtos</strong> — acesse o painel e clique em "Adicionar produto". Inclua fotos, descrição e preço.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 16px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">2</div>
          </td>
          <td style="vertical-align:top; padding:0 0 16px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Configure o pagamento</strong> — defina as formas de pagamento aceitas pela sua loja.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 0 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">3</div>
          </td>
          <td style="vertical-align:top; padding:0;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Compartilhe sua loja</strong> — seu link já está ativo. Divulgue na comunidade e comece a receber pedidos!
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${dashboardUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Acessar painel de vendedor →</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas? Fale com nossa equipe em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Sua loja foi aprovada! — ElosCloud',
    badgeText: 'Mercado Local',
    userName,
    bodyContent,
    preheader: `Sua loja "${businessName}" foi aprovada! Acesse o painel e comece a vender.`,
  });
};
