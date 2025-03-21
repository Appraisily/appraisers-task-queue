/**
 * Simple logger utility that outputs formatted logs
 * When running in Cloud Run, logs will be automatically captured by Cloud Logging
 */
const s3Logger = require('./s3Logger');

function createLogger(name) {
  return {
    info: (message, ...args) => {
      console.log(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to S3
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.info(sessionId, message, formatArgs(args));
      }
    },
    error: (message, ...args) => {
      console.error(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to S3
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.error(sessionId, message, formatArgs(args));
      }
    },
    warn: (message, ...args) => {
      console.warn(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to S3
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.warn(sessionId, message, formatArgs(args));
      }
    },
    debug: (message, ...args) => {
      console.debug(`[${name}]`, message, ...args);
      // Try to extract sessionId from args and log to S3
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.debug(sessionId, message, formatArgs(args));
      }
    },
    // Direct S3 logging method with explicit sessionId
    s3Log: (sessionId, level, message, data = {}) => {
      if (level === 'error') {
        console.error(`[${name}] [${level}] [SessionID: ${sessionId}]`, message, data);
        s3Logger.error(sessionId, message, data);
      } else if (level === 'warn') {
        console.warn(`[${name}] [${level}] [SessionID: ${sessionId}]`, message, data);
        s3Logger.warn(sessionId, message, data);
      } else {
        console.log(`[${name}] [${level}] [SessionID: ${sessionId}]`, message, data);
        s3Logger.info(sessionId, message, data);
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
 * Format arguments for logging to S3
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