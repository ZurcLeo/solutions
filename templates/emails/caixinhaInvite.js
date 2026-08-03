const wrapper = require('./wrapper');

/**
 * Template para convites de caixinha
 * @param {Object} data - Dados do template
 * @returns {string} Conteúdo HTML
 */
module.exports = function(data) {
  const caixinhaNome = data.caixinhaNome || 'Caixinha';
  const caixinhaDescricao = data.caixinhaDescricao || '';
  const contribuicaoMensal = data.contribuicaoMensal || 0;
  const senderName = data.senderName || 'Um membro';
  const userName = data.targetName || 'Pessoa querida';
  const message = data.message || '';
  const inviteLink = data.inviteLink || '#';
  const expirationDate = data.expirationDate || 'em breve';
  
  const bodyContent = `
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px;">
        <strong>${senderName}</strong> convidou você para participar de uma caixinha colaborativa.
      </p>

      <!-- Detalhes da Caixinha -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:24px; border-left: 4px solid #B85C2A;">
        <h2 style="font-size:20px; color:#1A1410; margin-bottom:8px;">${caixinhaNome}</h2>
        ${caixinhaDescricao ? `<p style="font-size:14px; color:#4a3b32; margin-bottom:12px;">${caixinhaDescricao}</p>` : ''}
        <p style="font-size:16px; color:#1A1410;"><strong>Contribuição:</strong> R$ ${contribuicaoMensal.toFixed(2)} / mês</p>
      </div>

      ${message ? `
      <div style="background-color:#FFF8EE; border: 1px dashed #B5A99E; border-radius:12px; padding:16px; margin-bottom:24px; font-style: italic; color:#7A6F68;">
        "${message}"
      </div>` : ''}

      <!-- Chamada para ação principal -->
      <div style="text-align:center;">
        <a href="${inviteLink}" class="btn">🌿 Participar da Caixinha</a>
      </div>

      <div style="text-align:center; margin-top:24px; font-size:13px; color:#7A6F68;">
        <p>Este convite é válido até <strong>${expirationDate}</strong>.</p>
      </div>

      <!-- Informações sobre Caixinhas -->
      <div style="margin:32px 0 16px; font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px;">
        <strong>O que são as Caixinhas?</strong><br>
        São grupos de poupança e crédito colaborativo onde membros se apoiam mutuamente para alcançar objetivos financeiros com transparência e segurança.
      </div>
  `;

  return wrapper({
    title: `Convite para Caixinha: ${caixinhaNome} 🌱`,
    badgeText: '🤝 Convite de Colaboração Financeira 🤝',
    userName,
    bodyContent,
    preheader: `${senderName} convidou você para a caixinha ${caixinhaNome}. Saiba mais sobre como participar.`
  });
};
