const pino = require('pino');

function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino/file',
      options: {
        destination: 1,
        mkdir: true,
        sync: false
      }
    },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
      bindings: () => ({})
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    messageKey: 'message',
    base: null
  });
}

module.exports = { createLogger };