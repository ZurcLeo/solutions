/**
 * Template de email para pesquisa de satisfação CSAT pós-resolução (SUPP-CSAT-001).
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName        - Nome do usuário
 * @param {string} data.ticketId        - ID do ticket
 * @param {string} data.ticketTitle     - Título do ticket
 * @param {string} data.agentName       - Nome do agente que resolveu
 * @param {string} data.csatSurveyToken - Token único para a pesquisa (sem login)
 * @param {string} [data.frontendUrl]   - URL base do frontend
 * @returns {string} HTML do email
 */
const wrapper = require('./wrapper');

module.exports = function csatSurveyTemplate(data) {
  const {
    userName        = 'Usuário',
    ticketId        = '',
    ticketTitle     = 'Solicitação de Suporte',
    agentName       = 'Nossa Equipe',
    csatSurveyToken = '',
    frontendUrl     = process.env.FRONTEND_URL || 'https://eloscloud.com',
  } = data;

  const baseUrl = `${frontendUrl}/suporte/avaliacao/${csatSurveyToken}`;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const OK     = '#2E7D32';
  const WARN   = '#E67E22';
  const ERR    = '#C62828';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        O ticket <strong style="color:${TEXT};">#${ticketId} — ${ticketTitle}</strong> foi resolvido por <strong style="color:${TEXT};">${agentName}</strong>.
        Gostaríamos de saber como foi sua experiência.
      </p>

      <!-- Rating section -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:28px 24px; text-align:center; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:16px; font-weight:700; color:${TEXT}; margin:0 0 8px;">Avalie o atendimento</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; margin:0 0 20px;">
          Clique na nota que melhor descreve sua experiência:
        </p>
        <div>
          <a href="${baseUrl}?score=5" style="display:inline-block; background:${OK}; color:#FFFFFF; padding:10px 16px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Excelente</a>
          <a href="${baseUrl}?score=4" style="display:inline-block; background:${P}; color:#FFFFFF; padding:10px 16px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Muito Bom</a>
          <a href="${baseUrl}?score=3" style="display:inline-block; background:${WARN}; color:#FFFFFF; padding:10px 16px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Bom</a>
          <a href="${baseUrl}?score=2" style="display:inline-block; background:${WARN}; color:#FFFFFF; padding:10px 16px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Regular</a>
          <a href="${baseUrl}?score=1" style="display:inline-block; background:${ERR}; color:#FFFFFF; padding:10px 16px; border-radius:10px; text-decoration:none; font-weight:600; font-size:13px; margin:4px;">Ruim</a>
        </div>
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; margin:16px 0 0;">
          Você também pode deixar um comentário na página de avaliação.
        </p>
      </div>

      <!-- Fallback link -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:16px 20px; margin-bottom:32px; word-break:break-all;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Se os botões não funcionarem, acesse:<br>
          <a href="${baseUrl}" style="color:${P}; text-decoration:none;">${baseUrl}</a>
        </p>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Esta pesquisa expira em 7 dias. Obrigado por usar a ElosCloud!
        </p>
      </div>
  `;

  return wrapper({
    title: `Como foi seu atendimento? — Ticket #${ticketId}`,
    badgeText: 'Avaliação',
    userName,
    bodyContent,
    preheader: `Avalie o atendimento do ticket #${ticketId}. Sua opinião nos ajuda a melhorar.`,
  });
};
