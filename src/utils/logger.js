const pino = require('pino');

function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label })
    },
    timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    messageKey: 'message'
  });
}

module.exports = { createLogger };