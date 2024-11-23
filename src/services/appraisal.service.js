const { createLogger } = require('../utils/logger');

class AppraisalService {
  constructor(services) {
    this.logger = createLogger('AppraisalService');
    this.initialized = false;
    this.config = null;
    this.services = services;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing appraisal service...');
      this.config = config;

      // Initialize services sequentially to better handle dependencies
      await this.services.wordpress.initialize(config);
      this.logger.info('WordPress service initialized');

      await this.services.sheets.initialize(config);
      this.logger.info('Sheets service initialized');

      await this.services.openai.initialize(config);
      this.logger.info('OpenAI service initialized');

      await this.services.email.initialize(config);
      this.logger.info('Email service initialized');

      await this.services.pdf.initialize(config);
      this.logger.info('PDF service initialized');

      this.initialized = true;
      this.logger.info('Appraisal service initialized successfully');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize appraisal service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async processAppraisal(id, appraisalValue, description) {
    if (!this.initialized) {
      throw new Error('Appraisal service not initialized');
    }

    this.logger.info(`Starting appraisal process for ID ${id}`);
    
    try {
      // Step 1: Set Value
      await this.setAppraisalValue(id, appraisalValue, description);
      this.logger.info('✓ Value set successfully');

      // Step 2: Merge Descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      this.logger.info('✓ Descriptions merged successfully');

      // Step 3: Update Title
      await this.updateTitle(id, mergedDescription);
      this.logger.info('✓ Title updated successfully');

      // Step 4: Insert Template
      await this.insertTemplate(id);
      this.logger.info('✓ Template inserted successfully');

      // Step 5: Build PDF
      await this.buildPdf(id);
      this.logger.info('✓ PDF built successfully');

      // Step 6: Send Email
      await this.sendEmail(id);
      this.logger.info('✓ Email sent successfully');

      // Step 7: Mark as Complete
      await this.complete(id, appraisalValue, description);
      this.logger.info('✓ Appraisal marked as complete');

      this.logger.info(`Completed appraisal process for ID ${id}`);
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }

  // Implementation of individual steps...
  // Each method should use this.services.sheets, this.services.wordpress, etc.
}

module.exports = AppraisalService;