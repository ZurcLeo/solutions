// middlewares/cors.js
const cors = require('cors');

const allowedOrigins = [
  'https://eloscloud.com',
  'http://localhost:3000'
];

const corsOptions = {
  // Função para verificar se a origem é permitida
  origin: (origin, callback) => {
    // Permitir origem null para testes locais sem frontend
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS', // Métodos HTTP permitidos
  allowedHeaders: 'Content-Type, Authorization', // Cabeçalhos permitidos
  credentials: true, // Permitir cookies e credenciais
  optionsSuccessStatus: 204, // Status de sucesso para opções
  preflightContinue: true, // Continuar para o próximo middleware após a resposta preflight
};

module.exports = cors(corsOptions);