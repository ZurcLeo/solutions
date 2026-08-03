/**
 * [SCHED-7C] Recibo de solicitação de agendamento para o CLIENTE.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName     - Nome do cliente
 * @param {string} data.serviceName  - Nome do serviço
 * @param {string} data.scheduledAt  - Data/hora do agendamento (ISO string ou formatado)
 * @param {string} data.providerName - Nome do prestador
 * @param {string} [data.manageUrl]  - URL para gerenciar agendamentos
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

function formatDate(isoOrLocale) {
  try {
    const d = new Date(isoOrLocale);
    if (!isNaN(d)) {
      return d.toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
    }
  } catch (_) { /* fallthrough */ }
  return isoOrLocale;
}

module.exports = function bookingCreated({ userName, serviceName, scheduledAt, providerName, manageUrl }) {
  const name     = userName     || 'Usuário';
  const service  = serviceName  || 'Serviço';
  const provider = providerName || 'Prestador';
  const date     = formatDate(scheduledAt);
  const url      = manageUrl    || `${APP_URL}/mercado/agendamentos`;

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
        Sua solicitação de agendamento foi enviada com sucesso.
        Assim que o prestador confirmar, você receberá um e-mail.
      </p>

      <!-- Detalhes do agendamento — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 12px;">Detalhes do agendamento</p>
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:4px 0;"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Serviço</span></td>
            <td align="right" style="padding:4px 0;"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${service}</strong></td>
          </tr>
          <tr>
            <td style="padding:4px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Prestador</span></td>
            <td align="right" style="padding:4px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${provider}</strong></td>
          </tr>
          <tr>
            <td style="padding:4px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Data e horário</span></td>
            <td align="right" style="padding:4px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${date}</strong></td>
          </tr>
        </table>
      </div>

      <!-- Info box -->
      <div style="background:${W_SOFT}; border:1.5px solid ${WARN}; border-radius:12px; padding:14px 18px; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          O prestador tem até <strong style="color:${TEXT};">2 horas</strong> para confirmar ou recusar.
          Se não houver resposta, o agendamento expira automaticamente.
        </p>
      </div>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:24px;">
        <a href="${url}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Ver meus agendamentos &rarr;</a>
      </div>

      <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; text-align:center; margin:0;">
        Você pode cancelar o agendamento a qualquer momento enquanto estiver pendente.
      </p>
  `;

  return wrapper({
    title: 'Solicitação enviada — ElosCloud',
    badgeText: 'Agendamento',
    userName: name,
    bodyContent,
    preheader: `Agendamento de "${service}" enviado. Aguardando confirmação do prestador.`,
  });
};
