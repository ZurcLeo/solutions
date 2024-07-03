// controllers/blacklistController.js
const { addToBlacklist, isTokenBlacklisted } = require('../services/blacklistService');

const addTokenToBlacklist = async (req, res) => {
  try {
    const { token } = req.body;
    await addToBlacklist(token);
    res.status(200).send('Token added to blacklist');
  } catch (error) {
    res.status(500).send('Error adding token to blacklist');
  }
};

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