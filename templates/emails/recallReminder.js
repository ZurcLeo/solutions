const wrapper = require('./wrapper');

const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

module.exports = function recallReminderTemplate(data) {
  const {
    userName     = 'Cliente',
    sellerName   = 'Negocio',
    serviceName  = '',
    daysSince    = '',
    message      = '',
    recallType   = 'return',
    optoutUrl    = '',
  } = data;

  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const ctaLabel = recallType === 'reorder' ? 'Ver produtos' : 'Agendar agora';
  const ctaUrl = recallType === 'reorder'
    ? `${APP_URL}/mercado`
    : `${APP_URL}/mercado/agendamentos`;

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 32px; font-size:16px; line-height:1.6;">
        ${message || `Faz ${daysSince} dias desde sua ultima visita a <strong>${sellerName}</strong>. Sentimos sua falta!`}
      </p>

      ${serviceName ? `
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${P}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">LEMBRETE</span>
        <p style="font-family:${FONT}; font-size:18px; font-weight:700; color:${TEXT}; margin:0 0 4px;">${serviceName}</p>
        <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; margin:0;">${sellerName}</p>
      </div>
      ` : `
      <div style="background:${P_SOFT}; border:1.5px solid ${P}; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${P}; color:#FFFFFF; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:12px;">LEMBRETE</span>
        <p style="font-family:${FONT}; font-size:18px; font-weight:700; color:${TEXT}; margin:0;">${sellerName}</p>
      </div>
      `}

      <div style="text-align:center; margin-bottom:32px;">
        <a href="${ctaUrl}" class="btn" style="display:inline-block; background:${P}; color:#FFFFFF !important; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px;">${ctaLabel} &rarr;</a>
      </div>

      <div style="border-top:1px solid ${BORDER}; padding-top:24px; text-align:center;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.5; margin:0;">
          Duvidas? Fale com nossa equipe em
          <a href="${APP_URL}/ajuda/chamados" style="color:${P}; text-decoration:none;">eloscloud.com/ajuda/chamados</a>.
        </p>
        ${optoutUrl ? `
        <p style="font-family:${FONT}; font-size:11px; color:#8A97A0; margin:16px 0 0; line-height:1.5;">
          Nao quer mais receber lembretes de ${sellerName}?
          <a href="${optoutUrl}" style="color:#8A97A0; text-decoration:underline;">Cancelar inscricao</a>
        </p>
        ` : ''}
      </div>
  `;

  const preheaderText = serviceName
    ? `Lembrete: ${serviceName} em ${sellerName} — ha ${daysSince} dias.`
    : `Sentimos sua falta em ${sellerName}!`;

  return wrapper({
    title: `Lembrete — ${sellerName}`,
    badgeText: 'Lembrete',
    userName,
    bodyContent,
    preheader: preheaderText,
  });
};
