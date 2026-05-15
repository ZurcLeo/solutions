const crypto = require('crypto');
const { calculateSeverity } = require('../utils/severityCalculator');
const SreRepository = require('../services/SreRepository');

/**
 * Lista de chaves que contém dados sensíveis (PII) e devem ser mascarados.
 */
const PII_KEYS = [
  'email', 'name', 'firstName', 'lastName', 'first_name', 'last_name',
  'cpf', 'cnpj', 'cpfCnpj', 'identificationNumber', 'number',
  'phone', 'telephone', 'address', 'street', 'complement', 'neighborhood',
  'password', 'token', 'accessToken', 'refreshToken', 'idToken',
  'firebaseToken', 'customToken', 'authorization', 'secret', 'key',
  'friendName', 'ja3Data', 'ja3'
];

/**
 * Chaves que devem ser transformadas em hashes determinísticos para rastreabilidade sem PII.
 */
const HASHABLE_KEYS = ['userId', 'uid', 'customerId', 'externalReference'];

/**
 * Sal de hashing para garantir que os hashes não sejam facilmente reversíveis via Rainbow Tables.
 * Em produção, isso deveria vir de uma variável de ambiente.
 */
const HASH_SALT = process.env.LOG_HASH_SALT || 'eloscloud-default-salt';

/**
 * Gera um hash determinístico para uma string.
 * @param {string} val 
 * @returns {string}
 */
function maskWithHash(val) {
  if (!val) return val;
  return crypto.createHmac('sha256', HASH_SALT).update(String(val)).digest('hex').substring(0, 12);
}

/**
 * Percorre recursivamente um objeto/array e aplica as regras de sanitização.
 */
function redactPII(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactPII);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // 1. Se for uma chave de hash, aplica o hash
    if (HASHABLE_KEYS.includes(key) && typeof value === 'string') {
      sanitized[key] = `hash:${maskWithHash(value)}`;
    }
    // 2. Se for uma chave de PII, mascara
    else if (PII_KEYS.includes(key)) {
      sanitized[key] = '[MASKED]';
    }
    // 3. Se for um objeto aninhado, recorre
    else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactPII(value);
    }
    // 4. Caso contrário, mantém o valor original
    else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Middleware de Sanitização Protocolo Zero-Data.
 * Intercepta a requisição e anexa um contexto sanitizado para fins de log e SRE.
 */
const sanitizerMiddleware = (req, res, next) => {
  // Captura o timestamp e hrtime de chegada
  const apiReceivedAt = new Date().toISOString();
  const startTime = process.hrtime();
  
  // Constrói o contexto sanitizado a partir de diferentes partes da request
  req.sreContext = {
    correlation_id: req.correlationId || 'no-correlation-id',
    api_received_at: apiReceivedAt,
    method: req.method,
    path: req.path,
    // Sanitiza body, query e params
    body: redactPII(req.body),
    query: redactPII(req.query),
    params: redactPII(req.params),
    // Informações de rede básicas
    userAgent: req.get('User-Agent'),
    // Se o usuário estiver autenticado, capturamos o ID hasheado
    userHash: req.user ? maskWithHash(req.user.uid || req.user.id) : 'anonymous'
  };

  // Interceptar a finalização da resposta para calcular severidade por latência ou status
  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const durationMs = diff[0] * 1000 + diff[1] / 1000000;
    
    // Calcula severidade baseado no resultado da requisição
    const severity = calculateSeverity(req.sreContext, {
      status: res.statusCode,
      durationMs
    });

    req.sreContext.duration_ms = durationMs.toFixed(2);
    req.sreContext.status_code = res.statusCode;
    req.sreContext.severity = severity.level;
    req.sreContext.severity_reason = severity.reason;

    // Persistência Assíncrona (Background) no PostgreSQL/Supabase
    SreRepository.saveContextLog(req.sreContext).catch(err => {
      const { logger } = require('../logger');
      logger.error('Failed to save SRE context log asynchronously', { error: err.message });
    });

    // Se for algo HIGH ou CRITICAL e não for um erro já tratado (que loga via next(err)), logamos aqui
    if ((severity.level === 'HIGH' || severity.level === 'CRITICAL') && res.statusCode < 500) {
      const { logger } = require('../logger');
      logger.warn(`High severity request detected: ${severity.reason}`, {
        sreContext: req.sreContext
      });
    }
  });

  next();
};

module.exports = {
  sanitizerMiddleware,
  redactPII,
  maskWithHash
};
