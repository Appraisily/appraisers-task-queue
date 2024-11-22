const { createLogger } = require('./logger');
const { withRetry } = require('./retry');

class ServiceManager {
  constructor() {
    this.logger = createLogger('ServiceManager');
    this.services = new Map();
    this.initialized = false;
  }

  register(name, service) {
    if (this.services.has(name)) {
      throw new Error(`Service ${name} already registered`);
    }
    this.services.set(name, service);
  }

  async initializeAll() {
    if (this.initialized) {
      return;
    }

    const services = Array.from(this.services.entries());
    
    for (const [name, service] of services) {
      try {
        await withRetry(
          () => service.initialize(),
          {
            retries: 3,
            name: `${name} initialization`
          }
        );
        this.logger.info(`${name} initialized successfully`);
      } catch (error) {
        this.logger.error(`Failed to initialize ${name}:`, error);
        throw error;
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
        this.logger.error(`Error shutting down ${name}:`, error);
      }
    }

    this.initialized = false;
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
    return Array.from(this.services.entries()).reduce((status, [name, service]) => {
      status[name] = service.isInitialized?.() ? 'initialized' : 'not_initialized';
      return status;
    }, {});
  }
}

module.exports = new ServiceManager();