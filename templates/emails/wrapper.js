/**
 * Reusable wrapper for ElosCloud emails.
 * Aligned to DESIGN_CONTRACT.md v0.1 — green-teal palette, Plus Jakarta Sans.
 *
 * @param {Object} params
 * @param {string} params.title       - Page <title>
 * @param {string} params.badgeText   - Text for the top badge (optional)
 * @param {string} params.userName    - Name of the user to greet
 * @param {string} params.bodyContent - The main HTML content of the email
 * @param {string} [params.preheader] - Preview text for email clients
 * @param {string} [params.accentColor] - Override primary color for context (default: --p #1A5C4A)
 * @returns {string} Complete HTML email string
 */
module.exports = function ({ title, badgeText, userName, bodyContent, preheader = '', accentColor = '' }) {
  const currentYear = new Date().getFullYear();
  const APP_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

  // Design Contract §02.1 tokens (hardcoded for email compatibility)
  const P     = accentColor || '#1A5C4A'; // --p  primary
  const P_SOFT = '#E8F1EE';              // --p-soft
  const BG     = '#F4F5F3';              // --bg
  const SURFACE = '#FFFFFF';             // --surface
  const TEXT   = '#2C3E50';              // --text
  const TEXT2  = '#495057';              // --text-2
  const TEXT3  = '#8A97A0';              // --text-3
  const BORDER = '#E9ECEF';             // --border
  const BRAND  = '#B0562F';             // --brand

  // Design Contract §03.1: Plus Jakarta Sans only
  const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body, table, td, p, a { margin:0; padding:0; font-family:${FONT}; }
    .container { max-width:600px; margin:0 auto; background:${SURFACE}; border-radius:12px; overflow:hidden; }
    .btn {
      display:inline-block; background:${P}; color:#FFFFFF !important;
      padding:12px 24px; border-radius:10px; text-decoration:none;
      font-weight:600; font-size:14px; line-height:1;
    }
    .btn-outline {
      display:inline-block; background:transparent; color:${P} !important;
      padding:10px 24px; border-radius:10px; text-decoration:none;
      font-weight:600; font-size:14px; line-height:1;
      border:1.5px solid ${P};
    }
    @media (max-width:639px) {
      .container { border-radius:0 !important; }
      .content { padding:24px 16px !important; }
      .btn, .btn-outline { display:block !important; text-align:center !important; }
    }
  </style>
</head>
<body style="margin:0; padding:24px 0; background-color:${BG}; -webkit-font-smoothing:antialiased;">
  <span style="display:none !important; visibility:hidden; mso-hide:all; font-size:1px; color:${BG}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${preheader}</span>

  <div class="container" style="max-width:600px; margin:0 auto; background:${SURFACE}; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.06);">

    <!-- Accent strip — §02 primary -->
    <div style="height:4px; background:${P};"></div>

    <!-- Content -->
    <div class="content" style="padding:32px 24px;">

      ${badgeText ? `
      <div style="text-align:center; margin-bottom:24px;">
        <span style="display:inline-block; background:${P_SOFT}; color:${P}; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase;">${badgeText}</span>
      </div>` : ''}

      <h1 style="font-family:${FONT}; text-align:center; font-size:24px; font-weight:700; color:${TEXT}; margin:0 0 8px; line-height:1.3;">
        Olá, <span style="color:${P};">${userName}</span>!
      </h1>

      ${bodyContent}

    </div>

    <!-- Footer — §03 typography -->
    <div style="border-top:1px solid ${BORDER}; padding:24px; text-align:center;">
      <p style="font-family:${FONT}; font-size:12px; color:${TEXT3}; margin:0;">
        © ${currentYear} ElosCloud — Rio de Janeiro, Brasil
      </p>
      <p style="font-family:${FONT}; font-size:12px; margin:8px 0 0;">
        <a href="${APP_URL}/terms" style="color:${TEXT2}; text-decoration:none;">Termos de uso</a>
        &nbsp;·&nbsp;
        <a href="${APP_URL}/privacy" style="color:${TEXT2}; text-decoration:none;">Privacidade</a>
        &nbsp;·&nbsp;
        <a href="${APP_URL}/help" style="color:${TEXT2}; text-decoration:none;">Ajuda</a>
      </p>
      <p style="font-family:${FONT}; font-size:11px; color:${TEXT3}; margin:12px 0 0;">
        Dúvidas? Fale com a <strong style="color:${TEXT2};">ClaudIA</strong> — nossa IA de suporte — diretamente no chat.
      </p>
    </div>

  </div>
</body>
</html>`;
};
