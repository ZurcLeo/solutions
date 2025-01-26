const cors = require('cors');
const { logger } = require('../logger');

const allowedOrigins = [
  'https://eloscloud.com',
  'http://localhost:3000',
  'http://localhost:9000',
  'https://backend-elos.onrender.com'
];

const corsOptions = {
  origin: (origin, callback) => {
    logger.info('Verificação de origem para CORS', {
      service: 'corsMiddleware',
      function: 'origin',
      origin
    });

    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      logger.info('Origem permitida por CORS', {
        service: 'corsMiddleware',
        function: 'origin',
        origin
      });
      callback(null, true);
    } else {
      logger.warn('Origem não permitida por CORS', {
        service: 'corsMiddleware',
        function: 'origin',
        origin
      });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS', // Métodos HTTP permitidos
  allowedHeaders: ['Content-Type', 'Authorization', 'userId', 'email'], // Cabeçalhos permitidos
  credentials: true, // Permitir cookies e credenciais
  optionsSuccessStatus: 204, // Status de sucesso para opções
  preflightContinue: true, // Continuar para o próximo middleware após a resposta preflight
};

module.exports = cors(corsOptions);