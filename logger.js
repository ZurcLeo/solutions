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
        msg += ` ${safeStringify(metadata)}`;
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