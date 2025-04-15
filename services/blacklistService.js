// services/blacklistService.js
const Blacklist = require('../models/BlackList');
const NodeCache = require('node-cache'); // Adicionar esta dependência

const blacklist = new Blacklist();
// Cache por 5 minutos (tempo suficiente para a maioria das operações)
const tokenCache = new NodeCache({ stdTTL: 300 });

const addToBlacklist = async (token) => {
  await blacklist.addToBlacklist(token);
  // Atualizar cache quando um token é adicionado à blacklist
  tokenCache.set(token, true);
};

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