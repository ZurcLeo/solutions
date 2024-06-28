// logger.js
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const rfs = require('rotating-file-stream');
const path = require('path');
const morgan = require('morgan');

const logDirectory = path.join(__dirname, 'log');
const accessLogStream = rfs.createStream('access.log', {
  interval: '1d', // rotaciona diariamente
  path: logDirectory,
});

const logger = createLogger({
  format: combine(
    timestamp(),
    printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'combined.log' }),
  ],
});

const morganMiddleware = morgan('combined', { stream: accessLogStream });

module.exports = {
  logger,
  morganMiddleware,
};