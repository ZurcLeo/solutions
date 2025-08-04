const cors = require('cors');
const { logger } = require('../logger');

// Separar origens por ambiente para melhor controle
const productionOrigins = [
  'https://eloscloud.com',
  'https://eloscloud.com.br',
  'https://backend-elos.onrender.com',
  'https://api.eloscloud.com',
  'https://accounts.google.com',
  'https://elossolucoescloud-1804e.firebaseapp.com',
  'https://oauth2.googleapis.com',
  'https://apis.google.com',
  'https://www.googleapis.com'
];

const developmentOrigins = [
  'http://localhost:3000',
  'https://localhost:3000',
  'http://localhost:9000',
  'https://localhost:9000'
];

// Always include production origins, add development ones if needed
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [...productionOrigins] 
  : [...productionOrigins, ...developmentOrigins];

// Log allowed origins for debugging
logger.info('CORS origins configured', {
  service: 'corsMiddleware',
  environment: process.env.NODE_ENV,
  allowedOrigins: allowedOrigins
});

// Enhanced CORS configuration with proper COOP settings
const corsOptions = {
  origin: (origin, callback) => {
    logger.info('Verificando origem CORS', {
      service: 'corsMiddleware',
      function: 'origin',
      origin,
      environment: process.env.NODE_ENV,
      userAgent: origin ? 'browser' : 'server-to-server'
    });

    // Allow requests without origin (e.g., mobile apps, postman)
    if (!origin) {
      logger.info('Requisição sem origem permitida', {
        service: 'corsMiddleware',
        environment: process.env.NODE_ENV
      });
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      logger.info('Origem permitida por lista exata', {
        service: 'corsMiddleware',
        origin,
        environment: process.env.NODE_ENV
      });
      return callback(null, true);
    }

    // Check for eloscloud.com domain and subdomains
    if (origin && /^https:\/\/(.*\.)?eloscloud\.com(\.br)?$/.test(origin)) {
      logger.info('Origem permitida por regex (eloscloud domain)', {
        service: 'corsMiddleware',
        origin,
        environment: process.env.NODE_ENV
      });
      return callback(null, true);
    }

    logger.error('Origem bloqueada por CORS', {
      service: 'corsMiddleware',
      origin,
      environment: process.env.NODE_ENV,
      allowedOrigins: allowedOrigins
    });
    return callback(new Error(`Origem '${origin}' não permitida por CORS`));
  },

  // Critical headers for authentication and cookies
  credentials: true,
  
  // Methods allowed for CORS requests
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  
  // Headers allowed in requests
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'userId',
    'email',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'X-Firebase-Token',
    'X-Client-Version',
    'X-Firebase-AppCheck',
    'X-Browser-Fingerprint'
  ],
  
  // Headers exposed to the client
  exposedHeaders: [
    'Content-Length', 
    'Content-Type',
    'Set-Cookie',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Credentials',
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Resource-Policy',
    'Cross-Origin-Embedder-Policy'
  ],
  
  // Cache preflight requests
  maxAge: process.env.NODE_ENV === 'production' ? 86400 : 3600,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Apply CORS first, then add custom headers
const corsMiddleware = cors(corsOptions);

// Export the direct CORS middleware
module.exports = corsMiddleware;