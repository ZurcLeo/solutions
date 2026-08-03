/**
 * @fileoverview Utilitários para mascarar PII (Dados Pessoais Identificáveis) em logs.
 * CPF, data de nascimento e nome completo NUNCA devem aparecer em plaintext em nenhum
 * log do sistema — seja em desenvolvimento, staging ou produção.
 *
 * Regra geral: preservar apenas o mínimo necessário para debug sem permitir
 * identificação da pessoa.
 */

/**
 * Mascara CPF para uso seguro em logs.
 * Exemplo: "12345678901" → "***.***.8901-01"  (últimos 4 dígitos)
 * @param {string|number} cpf
 * @returns {string}
 */
const maskCPF = (cpf) => {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (digits.length !== 11) return '***.***.***-**';
  return `***.***.*${digits.slice(6, 9)}-${digits.slice(9)}`;
};

/**
 * Mascara data de nascimento preservando apenas o ano (suficiente para debug de range).
 * Aceita ISO (YYYY-MM-DD) ou BR (DD/MM/YYYY).
 * Exemplo: "1990-05-23" => "__/__/1990"
 * @param {string} date
 * @returns {string}
 */
const maskBirthDate = (date) => {
  const str = String(date || '').trim();
  const iso  = str.match(/^(\d{4})-\d{2}-\d{2}$/);
  if (iso) return `**/**/${iso[1]}`;
  const br = str.match(/^\d{2}\/\d{2}\/(\d{4})$/);
  if (br) return `**/**/${br[1]}`;
  return '**/**/****';
};

/**
 * Mascara nome completo preservando apenas a inicial do primeiro nome.
 * Impede que logs revelem identidade via nome, respeitando que o nome visível
 * ao usuário na plataforma é apenas o primeiro nome + @username.
 * Exemplo: "João da Silva" → "J***"
 * @param {string} name
 * @returns {string}
 */
const maskName = (name) => {
  const str = String(name || '').trim();
  if (!str) return '***';
  return `${str.charAt(0).toUpperCase()}***`;
};

module.exports = { maskCPF, maskBirthDate, maskName };
