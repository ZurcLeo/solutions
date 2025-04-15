const cors = require('cors');
const { logger } = require('../logger');

// Separar origens por ambiente para melhor controle
const productionOrigins = [
  'https://eloscloud.com',
  'https://eloscloud.com.br',
  'https://backend-elos.onrender.com',
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

// Determine environment and select appropriate origins
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? productionOrigins 
  : [...productionOrigins, ...developmentOrigins];

// Enhanced CORS configuration with proper COOP settings
const corsOptions = {
  origin: (origin, callback) => {
    logger.info('Verificando origem CORS', {
      service: 'corsMiddleware',
      function: 'origin',
      origin,
      environment: process.env.NODE_ENV
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
      logger.info('Origem permitida', {
        service: 'corsMiddleware',
        origin,
        environment: process.env.NODE_ENV
      });
      return callback(null, true);
    }

    logger.warn('Origem bloqueada', {
      service: 'corsMiddleware',
      origin,
      environment: process.env.NODE_ENV
    });
    return callback(new Error('Origem não permitida por CORS'));
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

// Enhanced middleware with proper COOP and security headers
const corsMiddleware = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    // Critical for popup functionality
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Descomentar cada uma destas linhas
    res.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Allows popups while maintaining security
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
    
    // Fix cookie format and security settings
    res.header('Set-Cookie', [
      'SameSite=None',
      'Secure',
      'HttpOnly',
      'Path=/'
    ].join('; ')); // Space after semicolon important
  } else {
    // Production settings - same as development for consistency
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Allows popups while maintaining security
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
    
    // Fix cookie format and security settings
    res.header('Set-Cookie', [
      'SameSite=None',
      'Secure',
      'HttpOnly',
      'Path=/'
    ].join('; ')); // Space after semicolon important
  }

  // Apply CORS middleware with our options
  cors(corsOptions)(req, res, next);
}

module.exports = corsMiddleware;