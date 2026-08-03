const wrapper = require('./wrapper');

/**
 * Template for waitlist match notification emails.
 * Sent to B (existing member) when A (in waitlist) has B in their contacts.
 * @param {Object} data
 * @param {string} data.waitlistNome - Name of the person wanting to join
 * @param {number} [data.matchCount] - Number of waitlist matches (for bulk)
 * @returns {string} HTML content
 */
module.exports = function(data) {
  const nome = data.waitlistNome;
  const matchCount = data.matchCount;

  const APP_URL = process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://eloscloud.com' : 'https://localhost:3000');

  const invitesUrl = `${APP_URL}/configuracoes/convites`;

  const headline = nome
    ? `<strong style="color:#1A1410;">${nome}</strong> quer entrar na ElosCloud — e você está na agenda dele.`
    : matchCount > 1
      ? `<strong style="color:#1A1410;">${matchCount} pessoas</strong> da sua agenda querem entrar na ElosCloud.`
      : 'Alguém da sua agenda quer entrar na ElosCloud.';

  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px; font-size:16px; line-height:1.5;">
        ${headline}
      </p>

      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:32px;">
        <p style="margin-bottom:16px; font-size:15px; line-height:1.5; color:#1A1410;">
          Na ElosCloud, cada convite tem peso. Quando você convida alguém, está dizendo:
          <em>"eu confio nessa pessoa"</em>. Isso fortalece a rede e a sua reputação.
        </p>
        <p style="font-size:14px; color:#4a3b32; line-height:1.4;">
          Você decide se quer convidar — sem pressão, sem prazo. Se preferir, pode ignorar.
        </p>
      </div>

      <div style="text-align:center;">
        <a href="${invitesUrl}" class="btn">Ver quem está esperando</a>
      </div>

      <div style="font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px; margin-top:32px;">
        <strong>🔒 Privacidade</strong><br>
        ${nome ? `${nome} não sabe que você está na ElosCloud.` : 'Essas pessoas não sabem que você está na ElosCloud.'}
        A verificação é feita por impressão digital anônima dos números — ninguém vê sua agenda nem seus dados.
        Você pode desativar essa descoberta em Configurações → Privacidade.
      </div>
  `;

  const userName = 'vizinho(a)';

  return wrapper({
    title: 'Alguém que você conhece quer entrar',
    badgeText: '👋 Lista de espera',
    userName,
    bodyContent,
    preheader: nome
      ? `${nome} quer entrar na ElosCloud e você pode convidar.`
      : 'Alguém da sua agenda quer entrar na ElosCloud.',
  });
};
