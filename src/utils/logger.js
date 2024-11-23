const pino = require('pino');

function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        levelFirst: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
        customPrettifiers: {
          name: name => `[${name}]`
        }
      }
    },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() })
    }
  });
}

module.exports = { createLogger };