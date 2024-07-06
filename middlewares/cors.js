//middlewares/cors.js
const cors = require('cors');

const allowedOrigins = [
  'https://eloscloud.com',
  'http://localhost:3000',
  'https://www.facebook.com',
  'https://accounts.google.com',
  'https://eloscloudapp-1cefc4b4944e.herokuapp.com'
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir origem null para testes locais sem frontend
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
  credentials: true,
  optionsSuccessStatus: 204,
  preflightContinue: true,
};

module.exports = cors(corsOptions);