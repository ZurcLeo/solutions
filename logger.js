const { createLogger, format, transports, addColors } = require('winston');
const { combine, timestamp, printf } = format;
const rfs = require('rotating-file-stream');
const path = require('path');
const morgan = require('morgan');

const logDirectory = path.join(__dirname, 'log');
const accessLogStream = rfs.createStream('access.log', {
  interval: '1d', // rotaciona diariamente
  path: logDirectory,
});

const safeStringify = (obj) => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  });
};

// Campos que devem ser omitidos completamente dos logs
const LOG_MASK_FULL = new Set([
  'password', 'senha', 'secret', 'friendname', 'friendName'
]);

// Campos de token: manter apenas os primeiros 8 chars
const LOG_MASK_TRUNCATE = new Set([
  'token', 'accesstoken', 'accessToken', 'refreshtoken', 'refreshToken',
  'idtoken', 'idToken', 'firebasetoken', 'firebaseToken', 'customtoken',
  'customToken', 'authorization'
]);

const _maskEmail = (email) => {
  if (typeof email !== 'string') return email;
  const at = email.indexOf('@');
  if (at <= 0) return '[MASKED]';
  return email[0] + '***' + email.substring(at);
};

const maskLogMetadata = (obj, depth = 0) => {
  if (depth > 6 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => maskLogMetadata(item, depth + 1));
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lk = key.toLowerCase();
    if (LOG_MASK_FULL.has(lk) || LOG_MASK_FULL.has(key)) {
      result[key] = '[MASKED]';
    } else if (LOG_MASK_TRUNCATE.has(lk) || LOG_MASK_TRUNCATE.has(key)) {
      result[key] = typeof value === 'string' ? `${value.substring(0, 8)}[...]` : '[MASKED]';
    } else if (lk === 'email') {
      result[key] = _maskEmail(value);
    } else if (lk === 'ja3data' || lk === 'ja3') {
      result[key] = typeof value === 'object' && value !== null
        ? { hash: value.hash || value.ja3Hash || '[omitted]' }
        : value;
    } else if (typeof value === 'object') {
      result[key] = maskLogMetadata(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
};

const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    verbose: 4,
    silly: 5
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'cyan',
    verbose: 'blue',
    silly: 'magenta'
  }
};

addColors(customLevels.colors);

const colorizeMessage = (level, message) => {
  switch (level) {
    case 'info':
    return `\x1b[32m${message}\x1b[0m`; // Green
      case 'debug':
    return `\x1b[36m${message}\x1b[0m`; // Cyan
    case 'error':
      return `\x1b[31m${message}\x1b[0m`; // Red
    case 'warn':
      return `\x1b[33m${message}\x1b[0m`; // Yellow
    default:
      return message;
  }
};

const logger = createLogger({
  levels: customLevels.levels,
  format: combine(
    timestamp(),
    format.json(),
    printf(({ timestamp, level, message, ...metadata }) => {
      const error = metadata.error;
      let fileAndLine = '';
      if (error && error.stack) {
        const stack = error.stack.split('\n');
        const fileAndLineMatch = stack[1].match(/\((.*):(\d+):\d+\)/);
        if (fileAndLineMatch) {
          fileAndLine = ` (${fileAndLineMatch[1]}:${fileAndLineMatch[2]})`;
        }
      }

      let msg = `${timestamp} [${level}] : ${message} ${fileAndLine}`;
      if (metadata) {
        msg += ` [${metadata.service || 'unknown service'}] [${metadata.function || 'unknown function'}]`;
        if (metadata.subtype) {
          msg += ` [${metadata.subtype}]`;
        }
      }

      msg = colorizeMessage(level, msg);

      if (metadata) {
        msg += ` ${safeStringify(maskLogMetadata(metadata))}`;
      }

      return msg;
    })
  ),
  transports: [
    new transports.Console({ format: format.colorize({ all: true }) }),
    new transports.File({ filename: 'combined.log', maxsize: '20m', maxFiles: '10d' }) 
  ],
});

logger.jsonOutput = true;

const morganMiddleware = morgan('combined', { stream: accessLogStream });

module.exports = {
  logger,
  morganMiddleware,
};