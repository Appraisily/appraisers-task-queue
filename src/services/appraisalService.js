const sheetsService = require('./sheets.service');
const wordpressService = require('./wordpress.service');
const openaiService = require('./openai.service');
const emailService = require('./email.service');
const pdfService = require('./pdf.service');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');

class AppraisalService {
  constructor() {
    this.logger = createLogger('AppraisalService');
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize config first
      await config.initialize();

      // Then initialize all dependent services
      await Promise.all([
        sheetsService.initialize(),
        wordpressService.initialize(),
        openaiService.initialize(),
        emailService.initialize()
      ]);
      
      this.initialized = true;
      this.logger.info('Appraisal service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize appraisal service:', error);
      throw error;
    }
  }

  async setAppraisalValue(id, appraisalValue, description) {
    if (!this.initialized) {
      throw new Error('Appraisal service not initialized');
    }

    this.logger.info(`Setting appraisal value for ID ${id}`);
    
    try {
      const sheetName = config.GOOGLE_SHEET_NAME;
      
      // Update Google Sheets with value and description
      await sheetsService.updateValues(
        `${sheetName}!J${id}:K${id}`,
        [[appraisalValue, description]]
      );

      // Get WordPress URL from sheets
      const values = await sheetsService.getValues(
        `${sheetName}!G${id}`
      );

      if (!values || !values[0] || !values[0][0]) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      const wordpressUrl = values[0][0];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      if (!postId) {
        throw new Error(`Invalid WordPress URL for appraisal ${id}`);
      }

      // Update WordPress post with value
      await wordpressService.updatePost(postId, {
        acf: { value: appraisalValue }
      });

      this.logger.info(`Successfully set value for appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error setting value for appraisal ${id}:`, error);
      throw error;
    }
  }

  // ... rest of the methods remain the same ...

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
}

module.exports = new AppraisalService();