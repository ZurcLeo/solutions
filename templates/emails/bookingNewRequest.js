/**
 * Template de novo agendamento solicitado — notificação para o prestador.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName      - Nome do prestador (destinatário)
 * @param {string} data.serviceName   - Nome do serviço
 * @param {string} data.scheduledAt   - Data/hora do agendamento (ISO string ou formatado)
 * @param {string} data.expiresAt     - Prazo para aceitar
 * @param {string} [data.notes]       - Observações do cliente
 * @param {string} [data.manageUrl]   - URL para gerenciar o agendamento
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

module.exports = function bookingNewRequestTemplate(data) {
  const {
    userName    = 'Prestador',
    serviceName = 'serviço',
    scheduledAt = '',
    expiresAt   = '',
    notes       = '',
    manageUrl   = `${APP_URL}/mercado/vendedor`,
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
        Você recebeu uma nova solicitação de agendamento.
        Confirme ou recuse em até <strong style="color:${TEXT};">2 horas</strong>.
      </p>

      <!-- Detalhes — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 12px;">Detalhes da solicitação</p>
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:4px 0;"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Serviço</span></td>
            <td align="right" style="padding:4px 0;"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${serviceName}</strong></td>
          </tr>
          <tr>
            <td style="padding:4px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Data/Hora</span></td>
            <td align="right" style="padding:4px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${formatDate(scheduledAt)}</strong></td>
          </tr>
        </table>
      </div>

      ${notes ? `
      <!-- Observações do cliente -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Observações do cliente</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:0;">${notes}</p>
      </div>
      ` : ''}

      <!-- Prazo -->
      <div style="background:${W_SOFT}; border:1.5px solid ${WARN}; border-radius:12px; padding:14px 18px; margin-bottom:32px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; margin:0;">
          Prazo para responder: <strong style="color:${TEXT};">${formatDate(expiresAt)}</strong><br>
          Após este prazo, a solicitação expira automaticamente.
        </p>
      </div>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${manageUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Gerenciar agendamentos &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas? Fale com nossa equipe em
          <a href="${APP_URL}/suporte" style="color:${P}; text-decoration:none;">eloscloud.com/suporte</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Novo agendamento solicitado — ElosCloud',
    badgeText: 'Agendamento',
    userName,
    bodyContent,
    preheader: `Nova solicitação de "${serviceName}" para ${formatDate(scheduledAt)}. Confirme em até 2h.`,
  });
};
