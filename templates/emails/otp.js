/**
 * @fileoverview Template de e-mail para códigos OTP de verificação de operações.
 * Usa wrapper.js alinhado ao DESIGN_CONTRACT.md v0.1.
 * @module templates/emails/otp
 */
const wrapper = require('./wrapper');

const TYPE_LABELS = {
  login:         'acesso à sua conta',
  saque:         'saque / transferência',
  kyc:           'verificação de identidade (KYC)',
  email_verify:  'confirmação de e-mail',
  pagamento_pix: 'pagamento via PIX',
};

/**
 * @param {Object} data
 * @param {string} data.userName  - Nome do usuário
 * @param {string} data.code     - Código de 6 dígitos
 * @param {string} data.type     - Tipo da operação
 * @param {number} data.expiresIn - Validade em segundos
 * @returns {string} HTML do e-mail
 */
module.exports = function otpTemplate({ userName, code, type, expiresIn }) {
  const operationLabel = TYPE_LABELS[type] || type;
  const minutes = Math.round(expiresIn / 60);
  const expiresLabel = minutes === 1 ? '1 minuto' : `${minutes} minutos`;

  // Design Contract §02.1 tokens
  const P      = '#1A5C4A';
  const P_SOFT = '#E8F1EE';
  const TEXT   = '#2C3E50';
  const TEXT2  = '#495057';
  const BORDER = '#E9ECEF';
  const FONT   = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  const bodyContent = `
      <p style="font-family:${FONT}; text-align:center; color:${TEXT2}; margin:8px 0 8px; font-size:16px; line-height:1.6;">
        Você solicitou um código para:<br>
        <strong style="color:${TEXT};">${escapeHtml(operationLabel)}</strong>
      </p>

      <!-- Código OTP -->
      <div style="background:${P_SOFT}; border:2px dashed ${P}; border-radius:12px; padding:32px 24px; margin:24px 0 24px; text-align:center;">
        <div style="font-family:'Courier New', monospace; font-size:42px; font-weight:700; letter-spacing:12px; color:${P};">
          ${escapeHtml(String(code))}
        </div>
        <p style="font-family:${FONT}; margin:16px 0 0; font-size:14px; color:${P}; font-weight:600;">
          Este código expira em ${escapeHtml(expiresLabel)}
        </p>
      </div>

      <p style="font-family:${FONT}; font-size:14px; color:${TEXT2}; text-align:center; margin-bottom:32px;">
        Por segurança, não compartilhe este código com ninguém.
      </p>

      <!-- Nota de segurança -->
      <div style="background:${P_SOFT}; border-radius:12px; padding:20px 24px; margin-bottom:32px;">
        <p style="font-family:${FONT}; font-size:13px; color:${TEXT2}; line-height:1.6; margin:0;">
          <strong style="color:${TEXT};">Não foi você?</strong><br>
          Se você não reconhece esta ação, ignore este e-mail. Sua conta permanece protegida.
          Em caso de dúvida, fale com a <strong>ClaudIA</strong> em nosso app.
        </p>
      </div>
  `;

  return wrapper({
    title: 'Código de Verificação — ElosCloud',
    badgeText: 'Segurança',
    userName: userName || 'usuário',
    bodyContent,
    preheader: `Seu código de verificação: ${escapeHtml(String(code))}. Expira em ${escapeHtml(expiresLabel)}.`,
  });
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
