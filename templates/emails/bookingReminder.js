/**
 * Template de lembrete de agendamento — notificacao ao cliente (D-1 e H-2).
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * RECALL-001
 *
 * @param {Object} data
 * @param {string} data.userName      - Nome do cliente
 * @param {string} data.serviceName   - Nome do servico
 * @param {string} data.sellerName    - Nome do negocio/prestador
 * @param {string} data.date          - Data formatada (ex: "28/08/2026")
 * @param {string} data.time          - Horario formatado (ex: "14:30")
 * @param {string} [data.address]     - Endereco do prestador
 * @param {string} [data.reminderType] - '1d' ou '2h'
 * @param {string} [data.bookingUrl]  - URL para visualizar o agendamento
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function bookingReminderTemplate(data) {
  const {
    userName      = 'Cliente',
    serviceName   = 'Servico',
    sellerName    = 'Prestador',
    date          = '',
    time          = '',
    address       = '',
    reminderType  = '1d',
    bookingUrl    = `${APP_URL}/mercado/agendamentos`,
  } = data;

  // Design Contract tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const WARN   = '#E65100';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const is2h = reminderType === '2h';

  const badgeColor = is2h ? WARN : P;
  const badgeLabel = is2h ? 'EM 2 HORAS' : 'AMANHA';
  const introText = is2h
    ? 'Seu agendamento e <strong>em 2 horas</strong>. Prepare-se!'
    : 'Seu agendamento e <strong>amanha</strong>. Anote na agenda!';

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        ${introText}
      </p>

      <!-- Dados do agendamento -->
      <div style="background:${P_SOFT}; border:1.5px solid ${badgeColor}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${badgeColor}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">&#128276; ${badgeLabel}</span>
        <p style="font-family:${FONT}; font-size:18px; font-weight:700; color:${TEXT}; margin:0 0 4px;">${serviceName}</p>
        <p style="font-family:${FONT}; font-size:15px; color:${TEXT2}; margin:0;">${date} às ${time}</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; margin:8px 0 0;">${sellerName}</p>
      </div>

      ${address ? `
      <!-- Endereco -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Endereco</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:0;">${address}</p>
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
              <strong style="color:${TEXT};">Chegue com antecedencia</strong> de alguns minutos.
            </p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 0 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">2</div>
          </td>
          <td style="vertical-align:top; padding:0;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">
              <strong style="color:${TEXT};">Imprevisto?</strong> Cancele com antecedencia para evitar cobranças.
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${bookingUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Ver meus agendamentos &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Duvidas? Fale com nossa equipe em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  const preheaderText = is2h
    ? `Seu agendamento de ${serviceName} e em 2 horas (${time}).`
    : `Lembrete: ${serviceName} amanha, ${date} às ${time}.`;

  return wrapper({
    title: `Lembrete de agendamento — ElosCloud`,
    badgeText: 'Agendamento',
    userName,
    bodyContent,
    preheader: preheaderText,
  });
};
