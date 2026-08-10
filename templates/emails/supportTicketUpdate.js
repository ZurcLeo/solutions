/**
 * Template de atualização de status de ticket de suporte.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName       - Nome do usuário
 * @param {string} data.ticketId       - ID do ticket
 * @param {string} data.ticketTitle    - Título do ticket
 * @param {string} data.previousStatus - Status anterior
 * @param {string} data.newStatus      - Novo status
 * @param {string} [data.agentName]    - Nome do agente
 * @param {string} [data.updateNote]   - Nota de atualização
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

const STATUS_LABELS = {
  pending:     'Aguardando',
  assigned:    'Atribuído',
  in_progress: 'Em Andamento',
  resolved:    'Resolvido',
  closed:      'Fechado',
};

module.exports = function supportTicketUpdateTemplate(data) {
  const {
    userName       = 'Usuário',
    ticketId       = '',
    ticketTitle    = 'Solicitação de Suporte',
    previousStatus = '',
    newStatus      = '',
    agentName      = '',
    updateNote     = '',
  } = data;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const OK     = '#2E7D32';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const prevLabel = STATUS_LABELS[previousStatus] || previousStatus;
  const newLabel  = STATUS_LABELS[newStatus] || newStatus;

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        Temos uma atualização sobre seu ticket de suporte.
      </p>

      <!-- Transição de status -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 16px;">Status atualizado</p>
        <div style="font-family:${FONT}; font-size:14px; color:${TEXT};">
          ${previousStatus ? `
          <span style="display:inline-block; background:${BORDER}; color:${TEXT2}; font-weight:600; padding:6px 14px; border-radius:999px; font-size:13px;">${prevLabel}</span>
          <span style="display:inline-block; margin:0 8px; color:${TEXT2};">&rarr;</span>
          ` : ''}
          <span style="display:inline-block; background:${P}; color:#FFFFFF; font-weight:600; padding:6px 14px; border-radius:999px; font-size:13px;">${newLabel}</span>
        </div>
      </div>

      <!-- Info do ticket -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Ticket</span></td>
            <td align="right" style="padding:6px 0;"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">#${ticketId}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Título</span></td>
            <td align="right" style="padding:6px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${ticketTitle}</strong></td>
          </tr>
        </table>
      </div>

      ${agentName ? `
      <!-- Agente responsável -->
      <div style="background:${P_SOFT}; border-radius:12px; padding:14px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; margin:0;">
          <strong style="color:${TEXT};">Agente responsável:</strong> ${agentName} está cuidando do seu ticket.
        </p>
      </div>
      ` : ''}

      ${updateNote ? `
      <!-- Nota de atualização -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Observações</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0; font-style:italic;">${updateNote}</p>
      </div>
      ` : ''}

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${APP_URL}/ajuda/chamados" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Acompanhar meu ticket &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas? Fale com nossa equipe em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: `Atualização do Ticket #${ticketId} — ElosCloud`,
    badgeText: 'Suporte',
    userName,
    bodyContent,
    preheader: `Ticket #${ticketId} atualizado: ${newLabel}.`,
  });
};
