const { createLogger } = require('./logger');
const { withRetry } = require('./retry');

class ServiceManager {
  constructor() {
    this.logger = createLogger('ServiceManager');
    this.services = new Map();
    this.initialized = false;
    this.initializationErrors = new Map();
  }

  register(name, service) {
    if (this.services.has(name)) {
      throw new Error(`Service ${name} already registered`);
    }
    
    if (!service || typeof service.initialize !== 'function') {
      throw new Error(`Service ${name} must implement initialize() method`);
    }
    
    this.services.set(name, service);
  }

  async initializeAll() {
    if (this.initialized) {
      return;
    }

    this.initializationErrors.clear();
    const services = Array.from(this.services.entries());
    
    for (const [name, service] of services) {
      try {
        this.logger.info(`Starting initialization of ${name}...`);
        
        await withRetry(
          async () => {
            try {
              await service.initialize();
            } catch (error) {
              this.logger.error(`${name} initialization error:`, {
                error: error.message,
                stack: error.stack,
                cause: error.cause
              });
              throw error;
            }
          },
          {
            retries: 3,
            name: `${name} initialization`
          }
        );

        // Verify initialization was successful
        if (!service.isInitialized?.()) {
          throw new Error(`${name} initialize() completed but service reports as not initialized`);
        }

        this.logger.info(`${name} initialized successfully`);
      } catch (error) {
        const fullError = {
          message: error.message,
          stack: error.stack,
          cause: error.cause,
          service: name,
          timestamp: new Date().toISOString()
        };
        
        this.initializationErrors.set(name, fullError);
        this.logger.error(`Failed to initialize ${name}:`, fullError);
        throw new Error(`Service initialization failed: ${name}\n${JSON.stringify(fullError, null, 2)}`);
      }
    }

    this.initialized = true;
    this.logger.info('All services initialized successfully');
  }

  async shutdownAll() {
    const services = Array.from(this.services.entries()).reverse();
    
    for (const [name, service] of services) {
      try {
        if (typeof service.shutdown === 'function') {
          await service.shutdown();
          this.logger.info(`${name} shutdown successfully`);
        }
      } catch (error) {
        this.logger.error(`Error shutting down ${name}:`, {
          service: name,
          error: error.message,
          stack: error.stack
        });
      }
    }

    this.initialized = false;
    this.initializationErrors.clear();
    this.services.clear();
  }

  getService(name) {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found`);
    }
    return service;
  }

  isInitialized() {
    return this.initialized;
  }

  getStatus() {
    const status = {};
    
    for (const [name, service] of this.services.entries()) {
      const error = this.initializationErrors.get(name);
      status[name] = {
        state: service.isInitialized?.() ? 'initialized' : 'not_initialized',
        error: error ? {
          message: error.message,
          timestamp: error.timestamp
        } : null
      };
    }
    
    return status;
  }

  getInitializationErrors() {
    return Object.fromEntries(this.initializationErrors);
  }
}

module.exports = new ServiceManager();