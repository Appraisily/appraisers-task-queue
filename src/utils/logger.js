/**
 * Simple logger utility that outputs formatted logs
 * When running in Cloud Run, logs will be automatically captured by Cloud Logging
 */
const gcsLogger = require('./gcsLogger');

function createLogger(name) {
  return {
    info: (message, ...args) => {
      console.log(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to GCS
      const sessionId = extractSessionId(args);
      if (sessionId) {
        gcsLogger.info(sessionId, message, formatArgs(args));
      }
    },
    error: (message, ...args) => {
      console.error(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to GCS
      const sessionId = extractSessionId(args);
      if (sessionId) {
        gcsLogger.error(sessionId, message, formatArgs(args));
      }
    },
    warn: (message, ...args) => {
      console.warn(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to GCS
      const sessionId = extractSessionId(args);
      if (sessionId) {
        gcsLogger.warn(sessionId, message, formatArgs(args));
      }
    },
    debug: (message, ...args) => {
      console.debug(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to GCS
      const sessionId = extractSessionId(args);
      if (sessionId) {
        gcsLogger.debug(sessionId, message, formatArgs(args));
      }
    },
    // Direct GCS logging method with explicit sessionId
    s3Log: (sessionId, level, message, data = {}) => {
      if (level === 'error') {
        console.error(`[${name}] [${level}] [SessionID: ${sessionId}]`, message, data);
        gcsLogger.error(sessionId, message, data);
      } else if (level === 'warn') {
        console.warn(`[${name}] [${level}] [SessionID: ${sessionId}]`, message, data);
        gcsLogger.warn(sessionId, message, data);
      } else {
        console.log(`[${name}] [${level}] [SessionID: ${sessionId}]`, message, data);
        gcsLogger.info(sessionId, message, data);
      }
    }
  };
}

/**
 * Extract session ID from arguments if available
 */
function extractSessionId(args) {
  // Look for an object with id or sessionId property
  for (const arg of args) {
    if (arg && typeof arg === 'object') {
      if (arg.sessionId) return arg.sessionId;
      if (arg.id && typeof arg.id === 'string' && arg.id.startsWith('cs_')) return arg.id;
    }
  }
  
  // Look for a string that looks like a session ID
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('cs_')) {
      return arg;
    }
  }
  
  return null;
}

/**
 * Format arguments for logging to GCS
 */
function formatArgs(args) {
  const result = {};
  
  for (const arg of args) {
    if (arg && typeof arg === 'object') {
      Object.assign(result, arg);
    }
  }
  
  // Remove sessionId from the data to avoid duplication
  if (result.sessionId) {
    delete result.sessionId;
  }
  
  return result;
}

module.exports = { createLogger };