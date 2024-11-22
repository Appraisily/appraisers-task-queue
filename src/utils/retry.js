const pRetry = require('p-retry');
const { createLogger } = require('./logger');

const logger = createLogger('Retry');

async function withRetry(operation, options = {}) {
  const {
    retries = 3,
    factor = 2,
    minTimeout = 1000,
    maxTimeout = 30000,
    name = 'operation'
  } = options;

  return pRetry(
    async (attempt) => {
      try {
        const result = await operation();
        if (attempt > 1) {
          logger.info(`${name} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        logger.warn(`${name} failed (attempt ${attempt}/${retries + 1}):`, error.message);
        throw error;
      }
    },
    {
      retries,
      factor,
      minTimeout,
      maxTimeout,
      onFailedAttempt: error => {
        logger.warn(
          `${name} failed, attempt ${error.attemptNumber}/${retries + 1}. ` +
          `${error.retriesLeft} retries left. Next attempt in ${error.computedDelay}ms`
        );
      }
    }
  );
}

module.exports = { withRetry };