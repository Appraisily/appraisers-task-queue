const { createLogger } = require('../utils/logger');

class AppraisalService {
  constructor(services) {
    this.logger = createLogger('AppraisalService');
    this.initialized = false;
    this.config = null;
    
    // Store service dependencies
    this.services = services;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.config = config;
      
      // Initialize all services in parallel
      await Promise.all([
        this.services.sheets.initialize(config),
        this.services.wordpress.initialize(config),
        this.services.openai.initialize(config),
        this.services.email.initialize(config),
        this.services.pdf.initialize(config)
      ]);

      this.initialized = true;
      this.logger.info('Appraisal service initialized');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize appraisal service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  // The rest of the methods remain the same, but use this.services.sheets, 
  // this.services.wordpress, etc. instead of direct service imports
}

module.exports = AppraisalService;