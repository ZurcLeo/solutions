const wrapper = require('./wrapper');

/**
 * Template for welcome emails when a user completes registration via invite
 * @param {Object} data - Template data
 * @param {string} data.friendName - User's name
 * @param {string} data.nome - Alias for friendName
 * @param {string} data.godfatherName - Name of the person who invited the user
 * @returns {string} HTML content
 */
module.exports = function(data) {
  const userName = data.friendName || data.nome || 'Pessoa querida';
  const godfatherName = data.godfatherName || 'Alguém especial';
  const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px;">
        <strong>${godfatherName}</strong> te convidou para a ElosCloud &mdash; e convites aqui t&ecirc;m peso.<br>
        Quem te trouxe responde pela sua entrada. E voc&ecirc; vai entender por qu&ecirc; isso importa.
      </p>

      <!-- O que é a ElosCloud -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:32px;">
        <h3 style="font-size:18px; margin-bottom:16px; color:#1A1410;">A ElosCloud &eacute; o bairro com endere&ccedil;o digital.</h3>
        <p style="margin-bottom:16px; font-size:15px; line-height:1.5; color:#4a3b32;">
          N&atilde;o &eacute; fintech. N&atilde;o &eacute; rede social. &Eacute; onde tudo que existe na sua rua finalmente tem um lugar:
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px; color:#4a3b32;">
          <tr><td style="padding-bottom:10px;">&#x1F6CD;&#xFE0F; <strong>Mercado Local</strong> &mdash; compre, venda e contrate quem mora perto</td></tr>
          <tr><td style="padding-bottom:10px;">&#x1F6F5; <strong>Entregas</strong> &mdash; vizinhos entregam para vizinhos, no pre&ccedil;o deles</td></tr>
          <tr><td style="padding-bottom:10px;">&#x1F3E0; <strong>Temporada</strong> &mdash; alugue ou hospede por dia ou semana</td></tr>
          <tr><td style="padding-bottom:10px;">&#x1F4AC; <strong>Comunidade</strong> &mdash; feed, presentes e conex&otilde;es do bairro</td></tr>
          <tr><td style="padding-bottom:10px;">&#x1F3E6; <strong>Caixinhas</strong> &mdash; poupan&ccedil;a coletiva com governan&ccedil;a real</td></tr>
          <tr><td style="padding-bottom:10px;">&#x1F3DB;&#xFE0F; <strong>&Aacute;gora Digital</strong> &mdash; sua voz na comunidade, relatos e enquetes</td></tr>
        </table>
      </div>

      <!-- Passaporte de Confiança -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:32px;">
        <h3 style="font-size:18px; margin-bottom:12px; color:#1A1410;">Seu Passaporte de Confian&ccedil;a</h3>
        <p style="font-size:15px; line-height:1.6; color:#4a3b32; margin-bottom:16px;">
          Cada compra, entrega cumprida, avalia&ccedil;&atilde;o positiva e participa&ccedil;&atilde;o na comunidade constr&oacute;i sua reputa&ccedil;&atilde;o &mdash; uma s&oacute;, que vale em tudo.
          Quanto mais voc&ecirc; usa, mais portas se abrem: limites de transa&ccedil;&atilde;o maiores, cust&oacute;dia de caixinhas, destaque no marketplace.
        </p>
        <div style="text-align:center;">
          <a href="${APP_URL}/passaporte-de-confianca" style="color:#B85C2A; font-weight:600; text-decoration:underline;">Ver meu Passaporte &rarr;</a>
        </div>
      </div>

      <!-- CTA principal -->
      <div style="text-align:center; margin-bottom:32px;">
        <a href="${APP_URL}" class="btn">&#x1F33F; Acessar minha conta</a>
      </div>

      <!-- Tabela "Por onde começar" -->
      <div style="margin-bottom:32px;">
        <h3 style="font-size:18px; margin-bottom:16px; color:#1A1410;">Por onde come&ccedil;ar</h3>
        <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px; border-collapse:collapse;">
          <tr style="background-color:#FAF3E8;">
            <td style="padding:10px 12px; border-radius:8px 0 0 0; font-weight:600; color:#1A1410;">O que voc&ecirc; quer fazer</td>
            <td style="padding:10px 12px; border-radius:0 8px 0 0; font-weight:600; color:#1A1410;">Por onde ir</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; color:#4a3b32; border-bottom:1px solid #EFE4CF;">Comprar ou contratar algu&eacute;m do bairro</td>
            <td style="padding:10px 12px; border-bottom:1px solid #EFE4CF;"><a href="${APP_URL}/mercado" style="color:#B85C2A; font-weight:600;">Mercado Local</a></td>
          </tr>
          <tr>
            <td style="padding:10px 12px; color:#4a3b32; border-bottom:1px solid #EFE4CF;">Trabalhar como entregador</td>
            <td style="padding:10px 12px; border-bottom:1px solid #EFE4CF;"><a href="${APP_URL}/delivery" style="color:#B85C2A; font-weight:600;">Delivery</a></td>
          </tr>
          <tr>
            <td style="padding:10px 12px; color:#4a3b32; border-bottom:1px solid #EFE4CF;">Participar da comunidade</td>
            <td style="padding:10px 12px; border-bottom:1px solid #EFE4CF;"><a href="${APP_URL}/posts" style="color:#B85C2A; font-weight:600;">Feed</a></td>
          </tr>
          <tr>
            <td style="padding:10px 12px; color:#4a3b32;">Dar sua opini&atilde;o sobre o bairro</td>
            <td style="padding:10px 12px;"><a href="${APP_URL}/agora/enquetes" style="color:#B85C2A; font-weight:600;">&Aacute;gora Digital</a></td>
          </tr>
        </table>
      </div>

      <!-- Segurança -->
      <div style="font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px; margin-bottom:16px;">
        <strong>&#x1F6E1;&#xFE0F; Seus dados est&atilde;o seguros.</strong> Criptografia AES-256, autentica&ccedil;&atilde;o em duas fatores e CPF nunca exibido inteiro &mdash; s&oacute; usado quando necess&aacute;rio.
        <a href="${APP_URL}/privacidade" style="color:#B85C2A;">Saiba mais</a>
      </div>
  `;

  return wrapper({
    title: `${godfatherName} te trouxe para o bairro`,
    badgeText: '&#x2728; Voc&ecirc; entrou pela porta certa',
    userName,
    bodyContent,
    preheader: `${godfatherName} te trouxe para o bairro — bem-vindo à ElosCloud`
  });
};
