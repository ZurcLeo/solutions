const nodemailer = require('nodemailer');
require('dotenv').config();

// Defina as variáveis de ambiente para o SMTP
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

// Configure o transporte do nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: smtpUser,
        pass: smtpPass
    },
    tls: {
        ciphers: 'SSLv3'
    }
});

// Função para obter o template de email
function getEmailTemplate(subject, content) {
    return `
       <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Boas‑vindas à ElosCloud 🌱</title>
  <style>
    /* Estilos base (fallback para clientes de e‑mail) */
    body, table, td, p, a {
      margin: 0;
      padding: 0;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FAF3E8; /* C.areia */
      border-radius: 24px;
    }
    .card {
      background-color: #FFF8EE; /* C.creme */
      border-radius: 24px;
      padding: 32px 24px;
      margin: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    h1, h2, h3 {
      font-family: 'Bricolage Grotesque', 'Georgia', serif;
      color: #1A1410; /* C.pedra */
      font-weight: 700;
    }
    .btn {
      display: inline-block;
      background-color: #B85C2A; /* C.terra */
      color: #FFFFFF; /* C.alvo */
      padding: 14px 28px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
      transition: background-color 0.2s;
    }
    .btn:hover {
      background-color: #D96E30; /* C.caju */
    }
    .footer-links {
      font-size: 12px;
      color: #7A6F68; /* C.fumo */
      text-align: center;
      margin-top: 24px;
      border-top: 1px solid #EFE4CF; /* C.palha */
      padding-top: 24px;
    }
    .badge {
      display: inline-block;
      background-color: #2D5016; /* C.mata */
      color: white;
      font-size: 12px;
      padding: 4px 12px;
      border-radius: 30px;
      margin-bottom: 16px;
    }
    @media (max-width: 600px) {
      .card { padding: 24px 16px; }
      .btn { display: block; text-align: center; }
    }
  </style>
</head>
<body style="margin:0;padding:20px 0;background-color:#EFE4CF;"> <!-- C.palha de fundo externo -->
  <div class="container">
    <div class="card">
      <!-- Selo de boas‑vindas -->
      <div style="text-align:center; margin-bottom:24px;">
        <span class="badge">✨ Bem‑vindo à sua nova jornada financeira ✨</span>
      </div>
      
      <!-- Título principal -->
      <h1 style="text-align:center; font-size:32px; margin-bottom:8px;">Olá, <strong style="color:#B85C2A;">Cemomu</strong>!</h1>
      <p style="text-align:center; color:#7A6F68; margin-bottom:32px;">Sua conta ElosCloud foi criada com sucesso.</p>

      <!-- Mensagem de propósito -->
      <div style="background-color:#FAF3E8; border-radius:16px; padding:24px; margin-bottom:32px;">
        <p style="margin-bottom:16px; font-size:16px; line-height:1.5; color:#1A1410;">
          🌍 <strong>A ElosCloud não é apenas uma fintech.</strong> É uma <strong>comunidade que transforma economia social</strong> 
          em redes de apoio financeiro. Aqui você pode:
        </p>
        <ul style="margin:0 0 0 20px; padding:0; color:#4a3b32;">
          <li>🤝 Criar <strong>caixinhas</strong> com amigos, família ou colegas.</li>
          <li>🎓 Aprender com <strong>gamificação e desafios econômicos</strong> (alinhados à BNCC).</li>
          <li>⚖️ Gerar <strong>contratos digitais revisados por advogados</strong> (com selo OAB).</li>
          <li>🔍 Acompanhar tudo com <strong>transparência, segurança e rastreabilidade</strong>.</li>
        </ul>
      </div>

      <!-- Chamada para ação principal -->
      <div style="text-align:center;">
        <a href="https://eloscloud.com/register?token=2f1b******e088" class="btn">🌿 Acessar minha conta</a>
        <p style="font-size:14px; color:#7A6F68; margin-top:8px;">Ou escaneie o QR Code abaixo</p>
        <!-- QR Code (simulação) – na prática, gerar imagem real -->
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://eloscloud.com/register?token=2f1b******e088" alt="QR Code" width="100" style="margin-top:8px; border-radius:12px;">
      </div>

      <!-- Seção de próximos passos (simplificada) -->
      <div style="margin:32px 0 24px;">
        <h3 style="font-size:18px; margin-bottom:12px;">🚀 Primeiros passos (3 minutos)</h3>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td width="40" style="vertical-align:top;">1️⃣</td><td><strong>Complete seu perfil</strong> – adicione uma foto e confirme seu e-mail.</td></tr>
          <tr><td width="40" style="vertical-align:top;">2️⃣</td><td><strong>Crie sua primeira caixinha</strong> ou aceite convites de amigos.</td></tr>
          <tr><td width="40" style="vertical-align:top;">3️⃣</td><td><strong>Explore a gamificação</strong> – ganhe XP e suba de nível.</td></tr>
        </table>
      </div>

      <!-- Informações de segurança e transparência -->
      <div style="font-size:13px; color:#7A6F68; background-color:#FAF3E8; border-radius:16px; padding:16px; margin-bottom:16px;">
        <strong>🛡️ Seus dados estão seguros</strong><br>
        Utilizamos criptografia bancária (AES‑256), autenticação em duas etapas para contratos e compartilhamento mínimo de informações – apenas com seu consentimento.
        <a href="#" style="color:#B85C2A;">Saiba mais</a>
      </div>

      <!-- Rodapé -->
      <div class="footer-links">
        <p>Copyright © 2026 ElosCloud | Rio de Janeiro, Brasil</p>
        <p>
          <a href="#" style="color:#7A6F68;">Termos de Uso</a> | 
          <a href="#" style="color:#7A6F68;">Política de Privacidade</a> | 
          <a href="#" style="color:#7A6F68;">Ajuda</a>
        </p>
        <p>Dúvidas? Fale com a <strong>Claud</strong> – nossa IA de suporte – diretamente no chat da plataforma.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;
}

// Função para enviar e-mail
async function sendEmail(to, subject, content) {
    const htmlContent = getEmailTemplate(subject, content);
    const mailOptions = {
        from: 'suporte@eloscloud.com',
        to: to,
        subject: subject,
        html: htmlContent,
        text: content.replace(/<[^>]*>?/gm, '') // Remove HTML tags for plain text version
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

module.exports = sendEmail;
