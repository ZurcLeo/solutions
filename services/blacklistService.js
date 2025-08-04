/**
 * @fileoverview Serviço de gerenciamento de blacklist para tokens JWT.
 * @module services/blacklistService
 * @requires ../models/BlackList
 * @requires node-cache
 */

const Blacklist = require('../models/BlackList');
const NodeCache = require('node-cache');

const blacklist = new Blacklist();
// Cache por 5 minutos (tempo suficiente para a maioria das operações)
const tokenCache = new NodeCache({
  stdTTL: 300
});

/**
 * Adiciona um token à blacklist.
 * @async
 * @function addToBlacklist
 * @param {string} token - O token JWT a ser adicionado à blacklist.
 * @returns {Promise<void>}
 * @description Adiciona o token fornecido à lista de tokens inválidos e atualiza o cache.
 */
const addToBlacklist = async (token) => {
  await blacklist.addToBlacklist(token);
  // Atualizar cache quando um token é adicionado à blacklist
  tokenCache.set(token, true);
};

/**
 * Verifica se um token está na blacklist.
 * @async
 * @function isTokenBlacklisted
 * @param {string} token - O token JWT a ser verificado.
 * @returns {Promise<boolean>} - Retorna `true` se o token estiver na blacklist, `false` caso contrário.
 * @description Primeiro verifica o cache, se o token não estiver presente, consulta o banco de dados e armazena o resultado no cache.
 */
const isTokenBlacklisted = async (token) => {
  // Verificar cache primeiro
  const cachedResult = tokenCache.get(token);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  // Se não estiver no cache, verificar no banco de dados
  const result = await blacklist.isTokenBlacklisted(token);
  // Armazenar resultado no cache
  tokenCache.set(token, result);
  return result;
};

/**
 * Remove tokens expirados da blacklist.
 * @async
 * @function removeExpiredTokens
 * @returns {Promise<void>}
 * @description Remove todos os tokens que já expiraram da blacklist persistente e limpa o cache.
 */
const removeExpiredTokens = async () => {
  await blacklist.removeExpiredTokens();
  // Limpar o cache após remover tokens expirados
  tokenCache.flushAll();
};

module.exports = {
  addToBlacklist,
  isTokenBlacklisted,
  removeExpiredTokens
};