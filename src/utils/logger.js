const pino = require('pino');

function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    messageKey: 'message',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
      // Properly format bindings
      bindings: (bindings) => {
        return { name: bindings.name };
      },
      // Custom log formatter to handle objects and errors better
      log: (object) => {
        const result = { ...object };
        
        // Handle Error objects specially
        if (object instanceof Error) {
          return {
            type: 'Error',
            message: object.message,
            stack: object.stack,
            code: object.code,
            ...object
          };
        }

        // Handle objects with error properties
        if (object.error instanceof Error) {
          result.error = {
            type: 'Error',
            message: object.error.message,
            stack: object.error.stack,
            code: object.error.code,
            ...object.error
          };
        }

        return result;
      }
    },
    serializers: {
      // Custom error serializer
      error: (error) => {
        if (!(error instanceof Error)) {
          return error;
        }

        return {
          type: error.constructor.name,
          message: error.message,
          stack: error.stack,
          code: error.code,
          details: error.details || {},
          response: error.response?.data,
          ...error
        };
      },
      // Ensure objects are properly serialized
      obj: (obj) => {
        try {
          return JSON.parse(JSON.stringify(obj));
        } catch (err) {
          return { error: 'Object serialization failed', original: String(obj) };
        }
      }
    },
    transport: {
      target: 'pino/file',
      options: {
        destination: 1,
        sync: false,
        mkdir: true
      }
    },
    base: null
  });
}

module.exports = { createLogger };