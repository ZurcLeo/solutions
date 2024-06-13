// emailTemplate.js
function getEmailTemplate(subject, content) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
            <style>
                @media screen and (max-width: 600px) {
                    .content {
                        width: 100% !important;
                        display: block !important;
                        padding: 10px !important;
                    }
                    .header, .body, .footer {
                        padding: 20px !important;
                    }
                }
            </style>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
        </head>
        <body style="font-family: 'Poppins', Arial, sans-serif;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                    <td align="center" style="padding: 20px;">
                        <table class="content" width="600" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: 1px solid #cccccc;">
                            <tr>
                                <td class="header" style="background-color: #345C72; padding: 40px; text-align: center; color: white; font-size: 24px;">
                                    ${subject}
                                </td>
                            </tr>
                            <tr>
                                <td class="body" style="padding: 40px; text-align: left; font-size: 16px; line-height: 1.6;">
                                    ${content}
                                </td>
                            </tr>
                            <tr>
                                <td class="footer" style="background-color: #333333; padding: 40px; text-align: center; color: white; font-size: 14px;">
                                    Copyright &copy; 2024 | ElosCloud
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;
}

module.exports = { getEmailTemplate };
