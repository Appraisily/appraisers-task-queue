const pino = require('pino');

function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  });
}

module.exports = { createLogger };