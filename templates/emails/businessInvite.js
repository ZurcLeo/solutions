const wrapper = require('./wrapper');

/**
 * Template para convites de equipe de negócio (Business Invite).
 * Usado tanto para usuários existentes quanto novos (não-cadastrados).
 *
 * @param {Object} data
 * @param {string} data.sellerName   - Nome do negócio
 * @param {string} data.inviterName  - Nome de quem convidou
 * @param {string} data.role         - Papel oferecido (manager, member, viewer)
 * @param {string} data.userName     - Nome do destinatário (ou 'Futuro(a) colega')
 * @param {string} [data.inviteLink] - Link para aceitar (registro ou in-app)
 * @returns {string} HTML completo do email
 */
module.exports = function (data) {
  const sellerName  = data.sellerName  || 'Negócio';
  const inviterName = data.inviterName || 'Um usuário';
  const role        = data.role        || 'membro';
  const userName    = data.userName    || 'Futuro(a) colega';
  const inviteLink  = data.inviteLink  || '#';
  const isNewUser   = !!data.isNewUser;

  const ROLE_LABELS = {
    manager: 'Gerente',
    member:  'Membro',
    viewer:  'Visualizador',
  };
  const roleLabel = ROLE_LABELS[role] || role;

  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px;">
        <strong>${inviterName}</strong> convidou você para fazer parte da equipe do negócio
        <strong>${sellerName}</strong> na ElosCloud.
      </p>

      <!-- Detalhes do Convite -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:24px; border-left: 4px solid #B85C2A;">
        <h2 style="font-size:20px; color:#1A1410; margin-bottom:8px;">${sellerName}</h2>
        <p style="font-size:16px; color:#1A1410; margin-bottom:4px;">
          <strong>Papel:</strong> ${roleLabel}
        </p>
        <p style="font-size:14px; color:#7A6F68;">
          ${isNewUser
            ? 'Crie sua conta na ElosCloud para aceitar o convite e começar a colaborar.'
            : 'Acesse a plataforma para aceitar o convite e começar a colaborar.'}
        </p>
      </div>

      <!-- Chamada para ação principal -->
      <div style="text-align:center;">
        <a href="${inviteLink}" class="btn">
          ${isNewUser ? 'Criar conta e aceitar convite' : 'Aceitar convite'}
        </a>
      </div>

      <div style="text-align:center; margin-top:24px; font-size:13px; color:#7A6F68;">
        <p>Este convite expira em <strong>7 dias</strong>.</p>
      </div>

      <!-- Info sobre a ElosCloud -->
      ${isNewUser ? `
      <div style="margin:32px 0 16px; font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px;">
        <strong>O que é a ElosCloud?</strong><br>
        Uma plataforma de economia local e colaborativa. Gerencie seu negócio, venda produtos e serviços, e conecte-se com sua comunidade.
      </div>` : ''}
  `;

  return wrapper({
    title: `Convite para equipe: ${sellerName}`,
    badgeText: 'Convite de Equipe',
    userName,
    bodyContent,
    preheader: `${inviterName} convidou você para a equipe de ${sellerName} na ElosCloud.`,
  });
};
