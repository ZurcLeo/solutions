// models/Blacklist.js
const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  token: { type: String, required: true },
  createdAt: { type: Date, expires: '7d', default: Date.now }
});

module.exports = mongoose.model('Blacklist', blacklistSchema);