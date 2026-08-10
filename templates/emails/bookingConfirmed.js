/**
 * Template de agendamento confirmado — notificação para o cliente.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName        - Nome do cliente
 * @param {string} data.scheduledAt     - Data/hora (ISO string ou formatado)
 * @param {string} [data.providerNotes] - Mensagem do prestador
 * @param {string} [data.bookingUrl]    - URL para visualizar o agendamento
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
  } catch { return iso; }
}

module.exports = function bookingConfirmedTemplate(data) {
  const {
    userName      = 'Cliente',
    scheduledAt   = '',
    providerNotes = '',
    bookingUrl    = `${APP_URL}/mercado/agendamentos`,
  } = data;

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
        Ótima notícia — o prestador
        <strong style="color:${OK};">confirmou</strong> seu agendamento.
        Anote a data e prepare-se!
      </p>

      <!-- Data confirmada — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${OK}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">&#10003; Confirmado</span>
        <p style="font-family:${FONT}; font-size:18px; font-weight:700; color:${TEXT}; margin:0;">${formatDate(scheduledAt)}</p>
      </div>

      ${providerNotes ? `
      <!-- Mensagem do prestador -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Mensagem do prestador</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:0;">${providerNotes}</p>
      </div>
      ` : ''}

      <!-- Dicas -->
      <table role="presentation" style="width:100%; border-collapse:collapse; margin-bottom:32px;">
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 12px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">1</div>
          </td>
          <td style="vertical-align:top; padding:0 0 12px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Verifique o local</strong> do serviço no seu agendamento.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 12px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">2</div>
          </td>
          <td style="vertical-align:top; padding:0 0 12px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Chegue com antecedência</strong> de alguns minutos.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 0 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">3</div>
          </td>
          <td style="vertical-align:top; padding:0;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Em caso de imprevisto</strong>, cancele com antecedência para não ser cobrado.
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${bookingUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Ver meus agendamentos &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas? Fale com nossa equipe em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Agendamento confirmado! — ElosCloud',
    badgeText: 'Agendamento',
    userName,
    bodyContent,
    preheader: `Seu agendamento foi confirmado para ${formatDate(scheduledAt)}.`,
  });
};
