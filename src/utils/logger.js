const S3Logger = require('./s3-logger');

// Initialize the S3 logger
const s3Logger = new S3Logger();

function createLogger(name) {
  return {
    info: (message, ...args) => {
      console.log(`[${name}]`, message, ...args);
      // Extract sessionId if available in args
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.info(sessionId, message, formatArgsForLogging(args));
      }
    },
    error: (message, ...args) => {
      console.error(`[${name}]`, message, ...args);
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.error(sessionId, message, formatArgsForLogging(args));
      }
    },
    warn: (message, ...args) => {
      console.warn(`[${name}]`, message, ...args);
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.warn(sessionId, message, formatArgsForLogging(args));
      }
    },
    debug: (message, ...args) => {
      console.debug(`[${name}]`, message, ...args);
      const sessionId = extractSessionId(args);
      if (sessionId) {
        s3Logger.debug(sessionId, message, formatArgsForLogging(args));
      }
    },
    // New method to explicitly log to S3 with sessionId
    s3Log: (sessionId, level, message, data = {}) => {
      console.log(`[${name}] [${level}]`, message, data);
      return s3Logger[level](sessionId, message, data);
    }
  };
}

/**
 * Try to extract session ID from arguments
 * @param {Array} args - Arguments to check for session ID
 * @returns {string|null} - The session ID if found, null otherwise
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
 * @param {Array} args - Arguments to format
 * @returns {Object} - Formatted arguments
 */
function formatArgsForLogging(args) {
  if (args.length === 0) return {};
  
  // If there's only one argument and it's an object, use that
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    return sanitizeForLogging(args[0]);
  }
  
  // Otherwise format as array
  return { args: args.map(arg => sanitizeForLogging(arg)) };
}

/**
 * Sanitize values for safe JSON logging
 * @param {*} value - Value to sanitize
 * @returns {*} - Sanitized value
 */
function sanitizeForLogging(value) {
  if (value === null || value === undefined) return value;
  
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  
  if (typeof value === 'object') {
    // Handle circular references
    try {
      JSON.stringify(value);
      return value;
    } catch (e) {
      return { error: 'Circular object reference detected' };
    }
  }
  
  return value;
}

module.exports = { createLogger };