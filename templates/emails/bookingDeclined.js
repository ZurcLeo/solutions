/**
 * Template de agendamento recusado — notificação para o cliente.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName    - Nome do cliente
 * @param {string} data.scheduledAt - Data/hora do agendamento recusado (ISO string)
 * @param {string} [data.reason]    - Motivo informado pelo prestador
 * @param {string} [data.searchUrl] - URL para buscar outros prestadores
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

module.exports = function bookingDeclinedTemplate(data) {
  const {
    userName    = 'Cliente',
    scheduledAt = '',
    reason      = '',
    searchUrl   = `${APP_URL}/mercado`,
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
        Infelizmente o prestador não pôde confirmar seu agendamento.
        Mas não se preocupe — há outros prestadores no Mercado Local!
      </p>

      <!-- Info do agendamento -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:4px 0;"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Horário</span></td>
            <td align="right" style="padding:4px 0;"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${formatDate(scheduledAt)}</strong></td>
          </tr>
          <tr>
            <td style="padding:4px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Status</span></td>
            <td align="right" style="padding:4px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${WARN}; font-weight:600;">Recusado pelo prestador</span></td>
          </tr>
        </table>
      </div>

      ${reason ? `
      <!-- Motivo -->
      <div style="background:${W_SOFT}; border:1.5px solid ${WARN}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${WARN}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Motivo informado</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:0;">${reason}</p>
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
              <strong style="color:${TEXT};">Pesquise outros prestadores</strong> para o mesmo serviço no Mercado Local.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 16px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">2</div>
          </td>
          <td style="vertical-align:top; padding:0 0 16px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Tente outro horário</strong> com o mesmo prestador.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 0 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">3</div>
          </td>
          <td style="vertical-align:top; padding:0;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Nenhum valor foi cobrado</strong> — a pré-autorização foi cancelada automaticamente.
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${searchUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Explorar outros prestadores &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Dúvidas? Fale com nossa equipe em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Agendamento não confirmado — ElosCloud',
    badgeText: 'Agendamento',
    userName,
    bodyContent,
    preheader: 'Seu agendamento não foi confirmado pelo prestador. Veja alternativas.',
  });
};
