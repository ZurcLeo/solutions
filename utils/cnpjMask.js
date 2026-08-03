/**
 * @fileoverview Utilitário para mascarar CNPJ em logs.
 * CNPJ NUNCA deve aparecer em plaintext em nenhum log do sistema.
 *
 * Formato de saída: "**.***.**\/****-XX"
 * Exemplo: CNPJ "12345678000195" → "**.***.**\/****-95"
 */

/**
 * Mascara CNPJ para uso seguro em logs.
 * @param {string|number} cnpj - CNPJ com ou sem pontuação
 * @returns {string} CNPJ mascarado no formato "**.***.**\/****-XX"
 */
const maskCNPJ = (cnpj) => {
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length !== 14) return '**.***.***/****-**';
  return `**.***.***/****-${digits.slice(12)}`;
};

module.exports = maskCNPJ;
