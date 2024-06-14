const cors = require('cors');

const corsOptions = {
  origin: 'https://eloscloud.com',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
  credentials: true,
  optionsSuccessStatus: 204
};

module.exports = cors(corsOptions);
