/**
 * Template de status de pedido para guest buyers (visitantes sem conta).
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * Statuses: paid, in_progress, completed, cancelled
 *
 * @param {Object} data
 * @param {string} data.guestName      - Nome do visitante
 * @param {string} data.orderId        - ID do pedido (UUID)
 * @param {string} data.status         - Status atual do pedido
 * @param {Array}  data.items          - Itens do pedido [{name, qty, unit_price_brl}]
 * @param {number} data.totalBrl       - Total em R$
 * @param {number} [data.deliveryFee]  - Taxa de entrega (se aplicável)
 * @param {string} data.trackingUrl    - URL de acompanhamento com token
 * @param {string} [data.sellerName]   - Nome da loja
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const STATUS_CONFIG = {
  paid: {
    subject:    'Pedido confirmado!',
    badge:      'Pagamento Confirmado',
    badgeColor: '#2E7D32',
    icon:       '&#10003;',
    heading:    'Seu pagamento foi confirmado!',
    message:    'O vendedor já recebeu seu pedido e em breve começará a prepará-lo.',
    preheader:  'Pagamento confirmado — seu pedido já está com o vendedor.',
  },
  in_progress: {
    subject:    'Seu pedido está sendo preparado',
    badge:      'Em Preparação',
    badgeColor: '#E67E22',
    icon:       '&#9881;',
    heading:    'Seu pedido está sendo preparado!',
    message:    'O vendedor está trabalhando no seu pedido. Acompanhe o andamento pelo link abaixo.',
    preheader:  'Seu pedido está em preparação — acompanhe em tempo real.',
  },
  completed: {
    subject:    'Pedido entregue!',
    badge:      'Entregue',
    badgeColor: '#2E7D32',
    icon:       '&#127881;',
    heading:    'Seu pedido foi entregue!',
    message:    'Esperamos que você tenha gostado! Obrigado por comprar com a gente.',
    preheader:  'Seu pedido foi entregue com sucesso. Obrigado pela compra!',
  },
  cancelled: {
    subject:    'Pedido cancelado',
    badge:      'Cancelado',
    badgeColor: '#C62828',
    icon:       '&#10007;',
    heading:    'Seu pedido foi cancelado',
    message:    'Infelizmente seu pedido foi cancelado. Se o pagamento já foi realizado, o estorno será processado automaticamente.',
    preheader:  'Seu pedido foi cancelado. Verifique os detalhes.',
  },
};

function formatCurrency(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

module.exports = function guestOrderStatusTemplate(data) {
  const {
    guestName   = 'Visitante',
    orderId     = '',
    status      = 'paid',
    items       = [],
    totalBrl    = 0,
    deliveryFee = 0,
    trackingUrl = '',
    sellerName  = '',
  } = data;

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.paid;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const TEXT3  = '#8A97A0';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  // Build items table rows
  const itemRows = items.map(item => `
        <tr>
          <td style="font-family:${FONT}; font-size:14px; color:${TEXT}; padding:8px 0; border-bottom:1px solid ${BORDER};">
            ${item.name}${item.qty > 1 ? ` <span style="color:${TEXT3};">&times;${item.qty}</span>` : ''}
          </td>
          <td style="font-family:${FONT}; font-size:14px; color:${TEXT}; padding:8px 0; border-bottom:1px solid ${BORDER}; text-align:right; white-space:nowrap;">
            ${formatCurrency(item.unit_price_brl * item.qty)}
          </td>
        </tr>`).join('');

  const subtotal = items.reduce((sum, i) => sum + (i.unit_price_brl * i.qty), 0);

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        ${cfg.heading}
      </p>

      <!-- Status badge — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${cfg.badgeColor}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">${cfg.icon} ${cfg.badge}</span>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; margin:0; line-height:1.5;">
          ${cfg.message}
        </p>
        ${sellerName ? `<p style="font-family:${FONT}; font-size:13px; color:${P}; margin:8px 0 0; font-weight:600;">${sellerName}</p>` : ''}
      </div>

      <!-- Order summary -->
      <div style="margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 12px;">
          Resumo do pedido #${orderId.substring(0, 8)}
        </p>
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          ${itemRows}
          ${deliveryFee > 0 ? `
          <tr>
            <td style="font-family:${FONT}; font-size:14px; color:${TEXT3}; padding:8px 0; border-bottom:1px solid ${BORDER};">Entrega</td>
            <td style="font-family:${FONT}; font-size:14px; color:${TEXT3}; padding:8px 0; border-bottom:1px solid ${BORDER}; text-align:right;">${formatCurrency(deliveryFee)}</td>
          </tr>` : ''}
          <tr>
            <td style="font-family:${FONT}; font-size:16px; font-weight:700; color:${TEXT}; padding:12px 0 0;">Total</td>
            <td style="font-family:${FONT}; font-size:16px; font-weight:700; color:${P}; padding:12px 0 0; text-align:right;">${formatCurrency(totalBrl)}</td>
          </tr>
        </table>
      </div>

      <!-- CTA — §05 button primary -->
      ${trackingUrl ? `
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${trackingUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Acompanhar pedido &rarr;</a>
      </div>
      ` : ''}

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas sobre seu pedido? Fale conosco em
          <a href="${process.env.FRONTEND_URL || 'https://eloscloud.com'}/suporte" style="color:${P}; text-decoration:none;">eloscloud.com/suporte</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: `${cfg.subject} — ElosCloud`,
    badgeText: 'Mercado Local',
    userName: guestName,
    bodyContent,
    preheader: cfg.preheader,
  });
};

// Expose STATUS_CONFIG for subject line resolution
module.exports.STATUS_CONFIG = STATUS_CONFIG;
