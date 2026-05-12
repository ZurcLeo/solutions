const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

const BLACKLIST_PATH = path.join(__dirname, '../blacklist.json');

/**
 * Adiciona um IP ou Token à blacklist local (blacklist.json)
 */
const addToLocalBlacklist = (id, type = 'token', reason = 'manual') => {
  try {
    let blacklist = [];
    if (fs.existsSync(BLACKLIST_PATH)) {
      const data = fs.readFileSync(BLACKLIST_PATH, 'utf8');
      blacklist = JSON.parse(data);
    }

    // Verificar se já existe
    if (blacklist.some(item => item.id === id)) {
      return false;
    }

    const newItem = {
      id,
      type,
      reason,
      createdAt: {
        _seconds: Math.floor(Date.now() / 1000),
        _nanoseconds: (Date.now() % 1000) * 1000000
      }
    };

    blacklist.push(newItem);
    fs.writeFileSync(BLACKLIST_PATH, JSON.stringify(blacklist, null, 2));
    
    logger.warn(`Item adicionado à blacklist local: ${id}`, { type, reason });
    return true;
  } catch (error) {
    logger.error('Erro ao atualizar blacklist.json', { error: error.message, id });
    return false;
  }
};

/**
 * Verifica se um IP ou Token está na blacklist local
 */
const isLocallyBlacklisted = (id) => {
  try {
    if (!fs.existsSync(BLACKLIST_PATH)) return false;
    const data = fs.readFileSync(BLACKLIST_PATH, 'utf8');
    const blacklist = JSON.parse(data);
    return blacklist.some(item => item.id === id);
  } catch (error) {
    return false;
  }
};

module.exports = {
  addToLocalBlacklist,
  isLocallyBlacklisted
};
