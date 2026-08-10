/**
 * Template de resolução de ticket de suporte.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName          - Nome do usuário
 * @param {string} data.ticketId          - ID do ticket
 * @param {string} data.ticketTitle       - Título do ticket
 * @param {string} data.agentName         - Nome do agente que resolveu
 * @param {string} data.resolutionSummary - Resumo da resolução
 * @param {string} data.resolutionDate    - Data da resolução
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function supportTicketResolvedTemplate(data) {
  const {
    userName          = 'Usuário',
    ticketId          = '',
    ticketTitle       = 'Solicitação de Suporte',
    agentName         = 'Nossa Equipe',
    resolutionSummary = 'Seu ticket foi resolvido com sucesso.',
    resolutionDate    = new Date().toLocaleString('pt-BR'),
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
        Temos o prazer de informar que seu ticket foi
        <strong style="color:${OK};">resolvido com sucesso</strong>.
      </p>

      <!-- Status card — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${OK}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">&#10003; Resolvido</span>
        <p style="font-family:${FONT}; font-size:18px; font-weight:700; color:${TEXT}; margin:0;">Ticket #${ticketId}</p>
      </div>

      <!-- Detalhes -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Título</span></td>
            <td align="right" style="padding:6px 0;"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${ticketTitle}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Resolvido por</span></td>
            <td align="right" style="padding:6px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${agentName}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Data</span></td>
            <td align="right" style="padding:6px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${resolutionDate}</strong></td>
          </tr>
        </table>
      </div>

      <!-- Resumo da resolução -->
      <div style="background:${P_SOFT}; border-radius:12px; padding:20px 24px; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Resumo da resolução</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0;">${resolutionSummary}</p>
      </div>

      <!-- Feedback -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:24px; text-align:center; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:16px; font-weight:700; color:${TEXT}; margin:0 0 8px;">Como foi nosso atendimento?</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; margin:0 0 20px;">Sua opinião nos ajuda a melhorar.</p>
        <div>
          <a href="${APP_URL}/feedback?ticket=${ticketId}&rating=5" style="display:inline-block; background:${P}; color:#FFFFFF; padding:8px 14px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Excelente</a>
          <a href="${APP_URL}/feedback?ticket=${ticketId}&rating=4" style="display:inline-block; background:${P}; color:#FFFFFF; padding:8px 14px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Bom</a>
          <a href="${APP_URL}/feedback?ticket=${ticketId}&rating=3" style="display:inline-block; background:${BORDER}; color:${TEXT}; padding:8px 14px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Regular</a>
          <a href="${APP_URL}/feedback?ticket=${ticketId}&rating=1" style="display:inline-block; background:${BORDER}; color:${TEXT}; padding:8px 14px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Precisa melhorar</a>
        </div>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Ainda precisa de ajuda? Fale conosco em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
      </div>
  `;

  return wrapper({
    title: `Ticket #${ticketId} resolvido — ElosCloud`,
    badgeText: 'Suporte',
    userName,
    bodyContent,
    preheader: `Seu ticket #${ticketId} foi resolvido! Avalie nosso atendimento.`,
  });
};
