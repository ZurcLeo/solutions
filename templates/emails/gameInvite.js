const wrapper = require('./wrapper');

/**
 * Template de email para convites de jogos/concursos da ElosCloud.
 *
 * @param {Object} data - Dados do template
 * @param {string} data.gameTitle       - Título do jogo
 * @param {string} data.gameType        - Tipo do jogo ('raffle'|'selection_list'|'secret_santa'|etc.)
 * @param {string} data.creatorName     - Nome do criador do jogo
 * @param {string} data.inviteLink      - URL completa para aceitar o convite
 * @param {string} data.expiresAt       - Data de expiração formatada (string legível)
 * @param {string} [data.recipientName] - Nome do destinatário (opcional)
 * @returns {string} Conteúdo HTML completo do email
 */
module.exports = function (data) {
  const gameTitle     = data.gameTitle     || 'Jogo';
  const creatorName   = data.creatorName   || 'Um amigo';
  const inviteLink    = data.inviteLink    || '#';
  const expiresAt     = data.expiresAt     || 'em breve';
  const recipientName = data.recipientName || 'Convidado';

  // Mapeia o tipo interno para um label amigável em português
  const GAME_TYPE_LABELS = {
    raffle:         'Rifa',
    selection_list: 'Lista de Seleção',
    secret_santa:   'Amigo Oculto',
    tournament:     'Torneio',
    challenge:      'Desafio',
    poll:           'Enquete',
  };
  const gameTypeLabel = GAME_TYPE_LABELS[data.gameType] || (data.gameType || 'Jogo');

  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px;">
        <strong>${creatorName}</strong> convidou você para participar de um jogo na ElosCloud.
      </p>

      <!-- Detalhes do Jogo -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:24px; border-left: 4px solid #B85C2A;">
        <h2 style="font-size:22px; color:#1A1410; margin-bottom:8px;">${gameTitle}</h2>
        <p style="font-size:14px; color:#4a3b32; margin-bottom:0;">
          <strong>Tipo:</strong> ${gameTypeLabel}
        </p>
        <p style="font-size:14px; color:#4a3b32; margin-top:8px; margin-bottom:0;">
          <strong>Organizado por:</strong> ${creatorName}
        </p>
      </div>

      <!-- Chamada para ação principal -->
      <div style="text-align:center; margin-bottom:24px;">
        <a href="${inviteLink}" class="btn">Aceitar Convite</a>
      </div>

      <!-- Prazo -->
      <div style="text-align:center; margin-top:8px; font-size:13px; color:#7A6F68;">
        <p>Este convite é válido até <strong>${expiresAt}</strong>.</p>
      </div>

      <!-- Sobre os Jogos -->
      <div style="margin:32px 0 16px; font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px;">
        <strong>O que são os Jogos ElosCloud?</strong><br>
        São atividades colaborativas e de entretenimento criadas pela comunidade — rifas, listas de seleção, amigo oculto e muito mais. Participe, divirta-se e acumule XP!
      </div>
  `;

  return wrapper({
    title:      `Convite para ${gameTypeLabel}: ${gameTitle}`,
    badgeText:  'Convite para Jogo',
    userName:   recipientName,
    bodyContent,
    preheader:  `${creatorName} convidou você para participar de "${gameTitle}" na ElosCloud.`,
  });
};
