function createLogger(name) {
  // Get global log level from environment variable, default to 'info'
  const logLevel = process.env.LOG_LEVEL || 'info';
  
  // Define log levels and their priorities
  const levels = {
    error: 0,   // Always show errors
    warn: 1,    // Show warnings unless 'error' only
    info: 2,    // Standard info level (default)
    debug: 3,   // Detailed logs for debugging
    trace: 4    // Extremely verbose logging
  };
  
  // Get numeric level for the configured log level
  const configuredLevel = levels[logLevel.toLowerCase()] !== undefined ? 
    levels[logLevel.toLowerCase()] : levels.info;
  
  // Function to check if a log should be displayed
  const shouldLog = (level) => levels[level] <= configuredLevel;

  return {
    error: (...args) => console.error(`[${name}]`, ...args),
    warn: (...args) => shouldLog('warn') && console.warn(`[${name}]`, ...args),
    info: (...args) => shouldLog('info') && console.log(`[${name}]`, ...args),
    debug: (...args) => shouldLog('debug') && console.debug(`[${name}]`, ...args),
    trace: (...args) => shouldLog('trace') && console.debug(`[${name}] (TRACE)`, ...args)
  };
}

module.exports = { createLogger };