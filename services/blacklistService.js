const BlackList = require('../models/BlackList');

const blacklist = new BlackList();

/**
 * Adiciona um token à blacklist.
 * @param {string} token - O token a ser adicionado.
 */
const addToBlacklist = async (token) => {
  await blacklist.addToBlacklist(token);
};

/**
 * Verifica se um token está na blacklist.
 * @param {string} token - O token a ser verificado.
 * @returns {boolean} - Retorna true se o token estiver na blacklist.
 */
const isTokenBlacklisted = async (token) => {
  const result = await blacklist.isTokenBlacklisted(token);
  console.log('Resultado da checagem de blacklist:', result);
  return result;
};

/**
 * Remove tokens expirados da blacklist.
 */
const removeExpiredTokens = async () => {
  await blacklist.removeExpiredTokens();
};

module.exports = {
  addToBlacklist,
  isTokenBlacklisted,
  removeExpiredTokens
};