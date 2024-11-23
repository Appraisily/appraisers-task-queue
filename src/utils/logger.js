const pino = require('pino');

function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino/file',
      options: {
        destination: 1, // stdout
        sync: false // async for better performance
      }
    },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
      bindings: () => ({})
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    messageKey: 'msg'
  });
}

module.exports = { createLogger };