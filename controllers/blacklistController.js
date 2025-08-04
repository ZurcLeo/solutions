/**
 * @fileoverview Controller de blacklist - gerencia tokens bloqueados/inválidos
 * @module controllers/blacklistController
 */

const { addToBlacklist, isTokenBlacklisted } = require('../services/blacklistService');

/**
 * Adiciona um token à blacklist para invalidá-lo
 * @async
 * @function addTokenToBlacklist
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados do token
 * @param {string} req.body.token - Token a ser bloqueado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<string>} Confirmação do bloqueio
 */
const addTokenToBlacklist = async (req, res) => {
  try {
    const { token } = req.body;
    await addToBlacklist(token);
    res.status(200).send('Token added to blacklist');
  } catch (error) {
    res.status(500).send('Error adding token to blacklist');
  }
};

/**
 * Verifica se um token está na blacklist
 * @async
 * @function checkTokenBlacklist
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.token - Token a ser verificado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Status do token (bloqueado ou não)
 */
const checkTokenBlacklist = async (req, res) => {
  try {
    const { token } = req.params;
    const blacklisted = await isTokenBlacklisted(token);
    res.status(200).send({ blacklisted });
  } catch (error) {
    res.status(500).send('Error checking token in blacklist');
  }
};

module.exports = {
  addTokenToBlacklist,
  checkTokenBlacklist
};