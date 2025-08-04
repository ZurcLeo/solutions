/**
 * Template for support ticket creation confirmation emails
 * @param {Object} data - Template data
 * @param {string} data.userName - User's name
 * @param {string} data.ticketId - Ticket ID
 * @param {string} data.ticketTitle - Ticket title
 * @param {string} data.priority - Ticket priority
 * @param {string} data.category - Ticket category
 * @param {string} data.description - Ticket description
 * @returns {string} HTML content
 */
module.exports = function(data) {
  const {
    userName = 'Usuário',
    ticketId = '',
    ticketTitle = 'Solicitação de Suporte',
    priority = 'medium',
    category = 'general',
    description = ''
  } = data;

  const priorityColors = {
    urgent: '#dc3545',
    high: '#fd7e14',
    medium: '#ffc107',
    low: '#28a745'
  };

  const priorityLabels = {
    urgent: 'Urgente',
    high: 'Alta',
    medium: 'Média',
    low: 'Baixa'
  };

  const categoryLabels = {
    financial: 'Financeiro',
    caixinha: 'Caixinha',
    loan: 'Empréstimo',
    account: 'Conta',
    technical: 'Técnico',
    security: 'Segurança',
    general: 'Geral'
  };

  const logoURL = process.env.LOGO_URL || "https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/logo.png";

  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket de Suporte Criado - #${ticketId}</title>
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
      .ticket-info {
        background-color: #f8f9fa;
        border-left: 4px solid #345C72;
        padding: 20px;
        margin: 20px 0;
        border-radius: 0 8px 8px 0;
      }
      .info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 10px 0;
        padding: 8px 0;
        border-bottom: 1px solid #e9ecef;
      }
      .info-row:last-child {
        border-bottom: none;
      }
      .info-label {
        font-weight: bold;
        color: #495057;
        flex: 0 0 30%;
      }
      .info-value {
        flex: 1;
        text-align: right;
      }
      .priority-badge {
        padding: 4px 12px;
        border-radius: 20px;
        color: white;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
      }
      .category-badge {
        padding: 4px 12px;
        border-radius: 6px;
        background-color: #e9ecef;
        color: #495057;
        font-size: 12px;
        font-weight: bold;
      }
      .description-box {
        background-color: #ffffff;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 15px;
        margin: 15px 0;
        font-style: italic;
        color: #666;
      }
      .next-steps {
        background-color: #e8f4fd;
        border-radius: 8px;
        padding: 20px;
        margin: 20px 0;
      }
      .steps-title {
        color: #0056b3;
        font-weight: bold;
        margin-bottom: 15px;
        font-size: 18px;
      }
      .step-item {
        margin: 10px 0;
        padding-left: 25px;
        position: relative;
      }
      .step-item::before {
        content: "✓";
        position: absolute;
        left: 0;
        top: 0;
        color: #28a745;
        font-weight: bold;
      }
      .support-contact {
        background-color: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 8px;
        padding: 15px;
        margin: 20px 0;
        text-align: center;
      }
      .contact-title {
        color: #856404;
        font-weight: bold;
        margin-bottom: 10px;
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
      .footer-links a:hover {
        text-decoration: underline;
      }
      @media screen and (max-width: 600px) {
        .email-container {
          margin: 10px;
          border-radius: 8px;
        }
        .email-body {
          padding: 20px;
        }
        .info-row {
          flex-direction: column;
          align-items: flex-start;
        }
        .info-value {
          text-align: left;
          margin-top: 5px;
        }
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <div class="header-icon">🎫</div>
        <h1 class="header-title">Ticket de Suporte Criado</h1>
        <p class="header-subtitle">Sua solicitação foi recebida com sucesso</p>
      </div>
      
      <div class="email-body">
        <p>Olá <strong>${userName}</strong>,</p>
        
        <p>Seu ticket de suporte foi criado com sucesso! Nossa equipe foi notificada e entrará em contato em breve.</p>
        
        <div class="ticket-info">
          <div class="info-row">
            <span class="info-label">Ticket ID:</span>
            <span class="info-value"><strong>#${ticketId}</strong></span>
          </div>
          <div class="info-row">
            <span class="info-label">Título:</span>
            <span class="info-value">${ticketTitle}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Categoria:</span>
            <span class="info-value">
              <span class="category-badge">${categoryLabels[category] || category}</span>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Prioridade:</span>
            <span class="info-value">
              <span class="priority-badge" style="background-color: ${priorityColors[priority]}">
                ${priorityLabels[priority] || priority}
              </span>
            </span>
          </div>
        </div>
        
        ${description ? `
        <div class="description-box">
          <strong>Descrição:</strong><br>
          ${description}
        </div>
        ` : ''}
        
        <div class="next-steps">
          <div class="steps-title">📋 Próximos Passos</div>
          <div class="step-item">Nossa equipe analisará sua solicitação</div>
          <div class="step-item">Você receberá atualizações por email</div>
          <div class="step-item">Um agente entrará em contato quando necessário</div>
          <div class="step-item">Você pode acompanhar o status pela aplicação</div>
        </div>
        
        <div class="support-contact">
          <div class="contact-title">📞 Precisa de ajuda urgente?</div>
          <p>Para questões urgentes, entre em contato conosco diretamente:</p>
          <p><strong>Email:</strong> suporte@eloscloud.com.br</p>
          <p><strong>WhatsApp:</strong> (11) 99999-9999</p>
        </div>
        
        <p style="margin-top: 30px;">
          <strong>Importante:</strong> Mantenha este email para referência futura. 
          O número do ticket <strong>#${ticketId}</strong> será necessário para acompanhar sua solicitação.
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