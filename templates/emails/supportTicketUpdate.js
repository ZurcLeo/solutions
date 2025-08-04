/**
 * Template for support ticket status update emails
 * @param {Object} data - Template data
 * @param {string} data.userName - User's name
 * @param {string} data.ticketId - Ticket ID
 * @param {string} data.ticketTitle - Ticket title
 * @param {string} data.previousStatus - Previous ticket status
 * @param {string} data.newStatus - New ticket status
 * @param {string} data.agentName - Agent name (if assigned)
 * @param {string} data.updateNote - Update note from agent
 * @returns {string} HTML content
 */
module.exports = function(data) {
  const {
    userName = 'Usuário',
    ticketId = '',
    ticketTitle = 'Solicitação de Suporte',
    previousStatus = '',
    newStatus = '',
    agentName = '',
    updateNote = ''
  } = data;

  const statusLabels = {
    pending: 'Aguardando Atendimento',
    assigned: 'Atribuído',
    in_progress: 'Em Andamento',
    resolved: 'Resolvido',
    closed: 'Fechado'
  };

  const statusColors = {
    pending: '#ffc107',
    assigned: '#17a2b8',
    in_progress: '#fd7e14',
    resolved: '#28a745',
    closed: '#6c757d'
  };

  const statusIcons = {
    pending: '⏳',
    assigned: '👨‍💼',
    in_progress: '🔄',
    resolved: '✅',
    closed: '🔒'
  };

  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Atualização do Ticket #${ticketId}</title>
    <style>
      body {
        font-family: 'Poppins', Arial, sans-serif;
        background-color: #f8f9fa;
        margin: 0;
        padding: 0;
        color: #333333;
      }
      .email-container {
        max-width: 600px;
        margin: 20px auto;
        background-color: #ffffff;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }
      .email-header {
        background: linear-gradient(135deg, #345C72 0%, #4a7c95 100%);
        color: white;
        text-align: center;
        padding: 30px 20px;
      }
      .header-icon {
        font-size: 48px;
        margin-bottom: 10px;
      }
      .header-title {
        font-size: 24px;
        font-weight: bold;
        margin: 0;
      }
      .header-subtitle {
        font-size: 16px;
        margin: 8px 0 0 0;
        opacity: 0.9;
      }
      .email-body {
        padding: 30px;
      }
      .status-update {
        background-color: #f8f9fa;
        border: 2px solid #e9ecef;
        border-radius: 12px;
        padding: 25px;
        margin: 25px 0;
        text-align: center;
      }
      .status-transition {
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 20px 0;
        flex-wrap: wrap;
      }
      .status-badge {
        padding: 8px 16px;
        border-radius: 20px;
        color: white;
        font-weight: bold;
        margin: 5px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .status-arrow {
        font-size: 24px;
        color: #6c757d;
        margin: 0 10px;
      }
      .ticket-info {
        background-color: #ffffff;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 20px;
        margin: 20px 0;
      }
      .info-row {
        display: flex;
        justify-content: space-between;
        margin: 12px 0;
        padding: 8px 0;
        border-bottom: 1px solid #f8f9fa;
      }
      .info-row:last-child {
        border-bottom: none;
      }
      .info-label {
        font-weight: bold;
        color: #495057;
      }
      .agent-info {
        background-color: #e8f4fd;
        border-left: 4px solid #0056b3;
        padding: 15px;
        margin: 20px 0;
        border-radius: 0 8px 8px 0;
      }
      .agent-title {
        color: #0056b3;
        font-weight: bold;
        margin-bottom: 8px;
      }
      .update-note {
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 15px;
        margin: 15px 0;
        font-style: italic;
      }
      .next-actions {
        background-color: #d4edda;
        border: 1px solid #c3e6cb;
        border-radius: 8px;
        padding: 20px;
        margin: 20px 0;
      }
      .actions-title {
        color: #155724;
        font-weight: bold;
        margin-bottom: 15px;
        font-size: 16px;
      }
      .action-item {
        margin: 8px 0;
        padding-left: 20px;
        position: relative;
      }
      .action-item::before {
        content: "→";
        position: absolute;
        left: 0;
        top: 0;
        color: #28a745;
        font-weight: bold;
      }
      .email-footer {
        background-color: #343a40;
        color: white;
        text-align: center;
        padding: 20px;
        font-size: 14px;
      }
      .footer-links a {
        color: #ffffff;
        text-decoration: none;
        margin: 0 10px;
      }
      @media screen and (max-width: 600px) {
        .email-container {
          margin: 10px;
        }
        .email-body {
          padding: 20px;
        }
        .status-transition {
          flex-direction: column;
        }
        .status-arrow {
          transform: rotate(90deg);
          margin: 10px 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <div class="header-icon">🔄</div>
        <h1 class="header-title">Atualização do Ticket</h1>
        <p class="header-subtitle">Seu ticket foi atualizado</p>
      </div>
      
      <div class="email-body">
        <p>Olá <strong>${userName}</strong>,</p>
        
        <p>Temos uma atualização sobre seu ticket de suporte:</p>
        
        <div class="status-update">
          <h3 style="margin: 0 0 20px 0; color: #345C72;">Status Atualizado</h3>
          <div class="status-transition">
            ${previousStatus ? `
            <div class="status-badge" style="background-color: ${statusColors[previousStatus]}">
              <span>${statusIcons[previousStatus]}</span>
              <span>${statusLabels[previousStatus] || previousStatus}</span>
            </div>
            <div class="status-arrow">→</div>
            ` : ''}
            <div class="status-badge" style="background-color: ${statusColors[newStatus]}">
              <span>${statusIcons[newStatus]}</span>
              <span>${statusLabels[newStatus] || newStatus}</span>
            </div>
          </div>
        </div>
        
        <div class="ticket-info">
          <div class="info-row">
            <span class="info-label">Ticket ID:</span>
            <span><strong>#${ticketId}</strong></span>
          </div>
          <div class="info-row">
            <span class="info-label">Título:</span>
            <span>${ticketTitle}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Data da Atualização:</span>
            <span>${new Date().toLocaleString('pt-BR')}</span>
          </div>
        </div>
        
        ${agentName ? `
        <div class="agent-info">
          <div class="agent-title">👨‍💼 Agente Responsável</div>
          <p style="margin: 0;">${agentName} está cuidando do seu ticket</p>
        </div>
        ` : ''}
        
        ${updateNote ? `
        <div class="update-note">
          <strong>📝 Observações do Agente:</strong><br>
          ${updateNote}
        </div>
        ` : ''}
        
        ${newStatus === 'resolved' ? `
        <div class="next-actions">
          <div class="actions-title">🎉 Seu ticket foi resolvido!</div>
          <div class="action-item">Verifique se a solução atendeu suas necessidades</div>
          <div class="action-item">Se tiver dúvidas, responda este email</div>
          <div class="action-item">Avalie nosso atendimento (opcional)</div>
        </div>
        ` : newStatus === 'assigned' ? `
        <div class="next-actions">
          <div class="actions-title">👨‍💼 Ticket atribuído</div>
          <div class="action-item">Um agente foi designado para seu caso</div>
          <div class="action-item">Você receberá atualizações conforme o andamento</div>
          <div class="action-item">Fique atento ao seu email</div>
        </div>
        ` : newStatus === 'in_progress' ? `
        <div class="next-actions">
          <div class="actions-title">🔄 Trabalhando na solução</div>
          <div class="action-item">Nossa equipe está trabalhando no seu caso</div>
          <div class="action-item">Você será notificado sobre o progresso</div>
          <div class="action-item">Qualquer informação adicional será solicitada</div>
        </div>
        ` : ''}
        
        <p style="margin-top: 30px;">
          Para acompanhar este ticket, acesse nossa <a href="https://eloscloud.com/suporte">Central de Suporte</a> 
          ou responda diretamente a este email.
        </p>
      </div>
      
      <div class="email-footer">
        <p style="margin: 0 0 10px 0;">
          <strong>ElosCloud - Suporte ao Cliente</strong>
        </p>
        <div class="footer-links">
          <a href="https://eloscloud.com">Portal</a>
          <a href="https://eloscloud.com/suporte">Central de Ajuda</a>
          <a href="https://eloscloud.com/contato">Contato</a>
        </div>
        <p style="font-size: 12px; margin: 15px 0 0 0; opacity: 0.8;">
          © ${new Date().getFullYear()} ElosCloud. Todos os direitos reservados.
        </p>
      </div>
    </div>
  </body>
  </html>
  `;
};