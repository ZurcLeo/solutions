/**
 * Template for support ticket resolution emails
 * @param {Object} data - Template data
 * @param {string} data.userName - User's name
 * @param {string} data.ticketId - Ticket ID
 * @param {string} data.ticketTitle - Ticket title
 * @param {string} data.agentName - Agent name who resolved
 * @param {string} data.resolutionSummary - Summary of resolution
 * @param {string} data.resolutionDate - Date of resolution
 * @returns {string} HTML content
 */
module.exports = function(data) {
  const {
    userName = 'Usuário',
    ticketId = '',
    ticketTitle = 'Solicitação de Suporte',
    agentName = 'Nossa Equipe',
    resolutionSummary = 'Seu ticket foi resolvido com sucesso.',
    resolutionDate = new Date().toLocaleString('pt-BR')
  } = data;

  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket Resolvido - #${ticketId}</title>
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
        background: linear-gradient(135deg, #28a745 0%, #34ce57 100%);
        color: white;
        text-align: center;
        padding: 40px 20px;
      }
      .header-icon {
        font-size: 64px;
        margin-bottom: 15px;
        animation: bounce 2s infinite;
      }
      @keyframes bounce {
        0%, 20%, 50%, 80%, 100% {
          transform: translateY(0);
        }
        40% {
          transform: translateY(-10px);
        }
        60% {
          transform: translateY(-5px);
        }
      }
      .header-title {
        font-size: 28px;
        font-weight: bold;
        margin: 0;
      }
      .header-subtitle {
        font-size: 18px;
        margin: 10px 0 0 0;
        opacity: 0.9;
      }
      .email-body {
        padding: 40px 30px;
      }
      .success-message {
        background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
        border: 2px solid #28a745;
        border-radius: 12px;
        padding: 25px;
        margin: 25px 0;
        text-align: center;
      }
      .success-title {
        color: #155724;
        font-size: 24px;
        font-weight: bold;
        margin: 0 0 15px 0;
      }
      .success-description {
        color: #155724;
        font-size: 16px;
        margin: 0;
      }
      .ticket-summary {
        background-color: #f8f9fa;
        border-left: 4px solid #28a745;
        padding: 20px;
        margin: 25px 0;
        border-radius: 0 8px 8px 0;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        margin: 12px 0;
        padding: 8px 0;
        border-bottom: 1px solid #e9ecef;
      }
      .summary-row:last-child {
        border-bottom: none;
      }
      .summary-label {
        font-weight: bold;
        color: #495057;
        flex: 0 0 40%;
      }
      .summary-value {
        flex: 1;
        text-align: right;
      }
      .resolution-details {
        background-color: #ffffff;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 20px;
        margin: 25px 0;
      }
      .resolution-title {
        color: #28a745;
        font-weight: bold;
        font-size: 18px;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .resolution-content {
        color: #495057;
        line-height: 1.6;
      }
      .feedback-section {
        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
        border: 1px solid #2196f3;
        border-radius: 12px;
        padding: 25px;
        margin: 30px 0;
        text-align: center;
      }
      .feedback-title {
        color: #0d47a1;
        font-size: 20px;
        font-weight: bold;
        margin: 0 0 15px 0;
      }
      .feedback-text {
        color: #1565c0;
        margin: 0 0 20px 0;
      }
      .rating-buttons {
        display: flex;
        justify-content: center;
        gap: 10px;
        margin: 20px 0;
        flex-wrap: wrap;
      }
      .rating-button {
        background-color: #2196f3;
        color: white;
        padding: 10px 15px;
        border-radius: 25px;
        text-decoration: none;
        font-weight: bold;
        margin: 5px;
        transition: background-color 0.3s;
      }
      .rating-button:hover {
        background-color: #1976d2;
      }
      .contact-info {
        background-color: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 8px;
        padding: 20px;
        margin: 25px 0;
      }
      .contact-title {
        color: #856404;
        font-weight: bold;
        margin-bottom: 15px;
        font-size: 16px;
      }
      .contact-item {
        margin: 8px 0;
        color: #856404;
      }
      .email-footer {
        background-color: #343a40;
        color: white;
        text-align: center;
        padding: 25px;
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
          padding: 25px 20px;
        }
        .summary-row {
          flex-direction: column;
        }
        .summary-value {
          text-align: left;
          margin-top: 5px;
        }
        .rating-buttons {
          flex-direction: column;
          align-items: center;
        }
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <div class="header-icon">🎉</div>
        <h1 class="header-title">Problema Resolvido!</h1>
        <p class="header-subtitle">Seu ticket foi finalizado com sucesso</p>
      </div>
      
      <div class="email-body">
        <p>Olá <strong>${userName}</strong>,</p>
        
        <div class="success-message">
          <div class="success-title">✅ Ticket Resolvido!</div>
          <div class="success-description">
            Temos o prazer de informar que seu ticket de suporte foi resolvido com sucesso.
          </div>
        </div>
        
        <div class="ticket-summary">
          <div class="summary-row">
            <span class="summary-label">Ticket ID:</span>
            <span class="summary-value"><strong>#${ticketId}</strong></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Título:</span>
            <span class="summary-value">${ticketTitle}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Resolvido por:</span>
            <span class="summary-value">${agentName}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Data de Resolução:</span>
            <span class="summary-value">${resolutionDate}</span>
          </div>
        </div>
        
        <div class="resolution-details">
          <div class="resolution-title">
            <span>📋</span>
            <span>Resumo da Resolução</span>
          </div>
          <div class="resolution-content">
            ${resolutionSummary}
          </div>
        </div>
        
        <div class="feedback-section">
          <div class="feedback-title">💭 Como foi nosso atendimento?</div>
          <p class="feedback-text">
            Sua opinião é muito importante para continuarmos melhorando nossos serviços.
          </p>
          <div class="rating-buttons">
            <a href="https://eloscloud.com/feedback?ticket=${ticketId}&rating=5" class="rating-button">⭐⭐⭐⭐⭐ Excelente</a>
            <a href="https://eloscloud.com/feedback?ticket=${ticketId}&rating=4" class="rating-button">⭐⭐⭐⭐ Muito Bom</a>
            <a href="https://eloscloud.com/feedback?ticket=${ticketId}&rating=3" class="rating-button">⭐⭐⭐ Bom</a>
            <a href="https://eloscloud.com/feedback?ticket=${ticketId}&rating=2" class="rating-button">⭐⭐ Regular</a>
            <a href="https://eloscloud.com/feedback?ticket=${ticketId}&rating=1" class="rating-button">⭐ Precisa Melhorar</a>
          </div>
        </div>
        
        <div class="contact-info">
          <div class="contact-title">📞 Ainda precisa de ajuda?</div>
          <div class="contact-item">Se sua dúvida não foi completamente esclarecida, não hesite em nos contatar:</div>
          <div class="contact-item"><strong>Email:</strong> suporte@eloscloud.com.br</div>
          <div class="contact-item"><strong>WhatsApp:</strong> (11) 99999-9999</div>
          <div class="contact-item"><strong>Horário:</strong> Segunda a Sexta, 9h às 18h</div>
        </div>
        
        <p style="margin-top: 30px; color: #28a745; font-weight: bold;">
          🚀 Obrigado por usar a ElosCloud! Estamos sempre aqui para ajudar.
        </p>
      </div>
      
      <div class="email-footer">
        <p style="margin: 0 0 15px 0;">
          <strong>ElosCloud - Suporte ao Cliente</strong>
        </p>
        <div class="footer-links">
          <a href="https://eloscloud.com">Portal</a>
          <a href="https://eloscloud.com/suporte">Central de Ajuda</a>
          <a href="https://eloscloud.com/contato">Contato</a>
          <a href="https://eloscloud.com/feedback">Feedback</a>
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