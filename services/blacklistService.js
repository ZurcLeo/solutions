// services/blacklistService.js
const Blacklist = require('../models/BlackList');

const blacklist = new Blacklist();

const addToBlacklist = async (token) => {
  await blacklist.addToBlacklist(token);
};

const isTokenBlacklisted = async (token) => {
  return await blacklist.isTokenBlacklisted(token);
};

const removeExpiredTokens = async () => {
  await blacklist.removeExpiredTokens();
};

module.exports = {
  addToBlacklist,
  isTokenBlacklisted,
  removeExpiredTokens
};