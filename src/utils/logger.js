function createLogger(name) {
  // Default log level is INFO (2)
  // 0 = ERROR, 1 = WARN, 2 = INFO, 3 = DEBUG
  const LOG_LEVEL = process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) : 2;
  
  // Track recent log messages to avoid repetition
  const recentLogs = new Map();
  const DUPLICATE_THRESHOLD_MS = 3000; // 3 seconds
  
  // Checks if this is a duplicate log message within threshold time
  const isDuplicate = (level, message) => {
    const key = `${level}:${message}`;
    const now = Date.now();
    
    if (recentLogs.has(key)) {
      const lastTime = recentLogs.get(key);
      if (now - lastTime < DUPLICATE_THRESHOLD_MS) {
        return true;
      }
    }
    
    recentLogs.set(key, now);
    // Clean up old entries
    if (recentLogs.size > 100) {
      const keysToDelete = [];
      for (const [k, time] of recentLogs.entries()) {
        if (now - time > DUPLICATE_THRESHOLD_MS) {
          keysToDelete.push(k);
        }
      }
      keysToDelete.forEach(k => recentLogs.delete(k));
    }
    
    return false;
  };
  
  // Create a simplified message by removing excess details
  const simplifyMessage = (args) => {
    if (args.length === 0) return '';
    
    // Convert all arguments to strings
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    return message;
  };
  
  return {
    error: (...args) => {
      if (LOG_LEVEL >= 0) {
        const message = simplifyMessage(args);
        console.error(`[${name}]`, message);
      }
    },
    
    warn: (...args) => {
      if (LOG_LEVEL >= 1) {
        const message = simplifyMessage(args);
        console.warn(`[${name}]`, message);
      }
    },
    
    info: (...args) => {
      if (LOG_LEVEL >= 2) {
        const message = simplifyMessage(args);
        if (!isDuplicate('info', message)) {
          console.log(`[${name}]`, message);
        }
      }
    },
    
    debug: (...args) => {
      if (LOG_LEVEL >= 3) {
        const message = simplifyMessage(args);
        if (!isDuplicate('debug', message)) {
          console.debug(`[${name}]`, message);
        }
      }
    }
  };
}

module.exports = { createLogger };