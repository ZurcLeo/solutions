/**
 * @fileoverview Compatibilidade retroativa — re-exporta maskCPF de piiMask.js.
 * Prefira importar diretamente de piiMask para acesso às demais funções (maskBirthDate, maskName).
 */
const { maskCPF } = require('./piiMask');
module.exports = maskCPF;
