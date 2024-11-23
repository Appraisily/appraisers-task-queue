const { createLogger } = require('../utils/logger');
const config = require('../config');
const { appraisalService } = require('../services');
const { initializePubSub } = require('./pubsub');

class Core {
  constructor() {
    this.logger = createLogger('Core');
    this.initialized = false;
    this.initializationPromise = null;
  }

  async initialize() {
    // Return existing promise if initialization is in progress
    if (this.initializationPromise) {
      this.logger.info('Core initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    // Return immediately if already initialized
    if (this.initialized) {
      this.logger.info('Core already initialized');
      return;
    }

    this.initializationPromise = (async () => {
      try {
        this.logger.info('Starting service initialization...');

        // 1. Initialize config and secrets first
        await config.initialize();
        this.logger.info('Configuration initialized');

        // 2. Initialize appraisal service (which handles all other services)
        await appraisalService.initialize(config);
        this.logger.info('Services initialized');

        // 3. Initialize PubSub last, after all services are ready
        await initializePubSub(appraisalService);
        this.logger.info('PubSub initialized');

        this.initialized = true;
        this.logger.info('Core initialization complete');
      } catch (error) {
        this.initialized = false;
        this.logger.error('Core initialization failed:', error);
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new Core();