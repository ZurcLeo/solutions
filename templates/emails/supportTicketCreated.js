/**
 * Template de confirmação de criação de ticket de suporte.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 *
 * @param {Object} data
 * @param {string} data.userName    - Nome do usuário
 * @param {string} data.ticketId    - ID do ticket
 * @param {string} data.ticketTitle - Título do ticket
 * @param {string} data.priority    - Prioridade (urgent|high|medium|low)
 * @param {string} data.category    - Categoria
 * @param {string} [data.description] - Descrição
 * @param {string} [data.estimatedResolutionDate] - Prazo estimado
 * @param {number} [data.slaHours]  - SLA em horas
 * @returns {string} HTML content
 */
const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

const PRIORITY_LABELS = {
  urgent: 'Urgente',
  high:   'Alta',
  medium: 'Média',
  low:    'Baixa',
};

const CATEGORY_LABELS = {
  financial: 'Financeiro',
  caixinha:  'Caixinha',
  loan:      'Empréstimo',
  account:   'Conta',
  technical: 'Técnico',
  security:  'Segurança',
  general:   'Geral',
};

module.exports = function supportTicketCreatedTemplate(data) {
  const {
    userName    = 'Usuário',
    ticketId    = '',
    ticketTitle = 'Solicitação de Suporte',
    priority    = 'medium',
    category    = 'general',
    description = '',
    estimatedResolutionDate = '',
    slaHours    = 72,
  } = data;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        Seu ticket de suporte foi criado com sucesso.
        Nossa equipe foi notificada e entrará em contato em breve.
      </p>

      <!-- Detalhes do ticket — §08 card style -->
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 12px;">Ticket #${ticketId}</p>
        <table role="presentation" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Título</span></td>
            <td align="right" style="padding:6px 0;"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${ticketTitle}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Categoria</span></td>
            <td align="right" style="padding:6px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${CATEGORY_LABELS[category] || category}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Prioridade</span></td>
            <td align="right" style="padding:6px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${P};">${PRIORITY_LABELS[priority] || priority}</strong></td>
          </tr>
          ${estimatedResolutionDate ? `
          <tr>
            <td style="padding:6px 0; border-top:1px solid ${BORDER};"><span style="font-family:${FONT}; font-size:13px; color:${TEXT2};">Prazo estimado</span></td>
            <td align="right" style="padding:6px 0; border-top:1px solid ${BORDER};"><strong style="font-family:${FONT}; font-size:13px; color:${TEXT};">${estimatedResolutionDate}</strong></td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${description ? `
      <!-- Descrição -->
      <div style="background:#FFFFFF; border:1.5px solid ${BORDER}; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-family:${FONT}; font-size:12px; font-weight:600; color:${P}; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 8px;">Descrição</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.6; margin:0; font-style:italic;">${description}</p>
      </div>
      ` : ''}

      <!-- Próximos passos — §12 stepper style -->
      <p style="font-family:${FONT}; font-size:16px; font-weight:700; color:${TEXT}; margin:0 0 16px;">
        Próximos passos:
      </p>

      <table role="presentation" style="width:100%; border-collapse:collapse; margin-bottom:32px;">
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 12px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">1</div>
          </td>
          <td style="vertical-align:top; padding:0 0 12px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">Nossa equipe analisará sua solicitação.</p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 12px 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">2</div>
          </td>
          <td style="vertical-align:top; padding:0 0 12px;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">Você receberá atualizações por e-mail.</p>
          </td>
        </tr>
        <tr>
          <td style="width:36px; vertical-align:top; padding:0 12px 0 0;">
            <div style="width:32px; height:32px; background:${P}; color:#FFFFFF; border-radius:10px; font-size:14px; font-weight:700; text-align:center; line-height:32px;">3</div>
          </td>
          <td style="vertical-align:top; padding:0;">
            <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; line-height:1.5; margin:4px 0 0;">Acompanhe o status pelo app a qualquer momento.</p>
          </td>
        </tr>
      </table>

      <!-- CTA — §05 button primary -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${APP_URL}/ajuda/chamados" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">Acompanhar meu ticket &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Mantenha este e-mail para referência. Ticket <strong>#${ticketId}</strong>.
        </p>
      </div>
  `;

  return wrapper({
    title: `Ticket #${ticketId} criado — ElosCloud`,
    badgeText: 'Suporte',
    userName,
    bodyContent,
    preheader: `Ticket #${ticketId} criado com sucesso. Nossa equipe já foi notificada.`,
  });
};
