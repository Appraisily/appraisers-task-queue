const { createLogger } = require('../utils/logger');
const ContentExtractionService = require('./content-extraction.service');
const GeminiService = require('./gemini.service');

/**
 * Service for migrating appraisals from old format to new format
 */
class MigrationService {
  constructor(wordpressService) {
    this.logger = createLogger('MigrationService');
    this.contentExtractionService = new ContentExtractionService(wordpressService);
    this.geminiService = new GeminiService();
    this.wordpressService = wordpressService;
    this.initialized = false;
  }

  /**
   * Initialize the migration service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing Migration service...');
      
      // Initialize Gemini service
      await this.geminiService.initialize();
      
      this.initialized = true;
      this.logger.info('Migration service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Migration service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  /**
   * Migrate an appraisal from old format to new format
   * @param {object} params - Migration parameters
   * @param {string} params.url - The URL of the existing appraisal
   * @param {string} params.sessionId - The session ID for the new appraisal
   * @param {string} params.customerEmail - The customer's email address
   * @param {object} params.options - Additional options
   * @returns {Promise<object>} - The migration data
   */
  async migrateAppraisal(params) {
    if (!this.isInitialized()) {
      throw new Error('Migration service not initialized');
    }
    
    const { url, sessionId, customerEmail, options = {} } = params;
    
    try {
      this.logger.info(`Migrating appraisal from URL: ${url} (Session ID: ${sessionId})`);
      
      // Validate required parameters
      if (!url) {
        throw new Error('URL is required');
      }
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      if (!customerEmail) {
        throw new Error('Customer email is required');
      }
      
      // Extract content from the URL
      const extractedData = await this.contentExtractionService.extractContent(url);
      
      // Process with Gemini
      const processedData = await this.geminiService.processAppraisalData(extractedData);
      
      // Combine data for response
      const responseData = {
        sessionId,
        customerEmail,
        migrationSource: url,
        mainImage: extractedData.images.main,
        ageImage: extractedData.images.age,
        signatureImage: extractedData.images.signature,
        value: extractedData.value,
        descriptions: {
          appraiser: extractedData.descriptions.appraiser,
          customer: extractedData.descriptions.customer,
          ai: extractedData.descriptions.ai
        },
        metadata: {
          title: processedData.title || extractedData.metadata.title,
          detailedTitle: processedData.detailedTitle || extractedData.metadata.detailedTitle,
          objectType: processedData.objectType || extractedData.metadata.objectType,
          creator: processedData.creator || extractedData.metadata.creator,
          age: processedData.age || extractedData.metadata.age,
          materials: processedData.materials || extractedData.metadata.materials,
          dimensions: processedData.dimensions || extractedData.metadata.dimensions,
          condition: processedData.condition || extractedData.metadata.condition,
          provenance: processedData.provenance || extractedData.metadata.provenance
        },
        mergedDescription: processedData.mergedDescription,
        timestamp: new Date().toISOString()
      };
      
      this.logger.info('Migration completed successfully');
      return responseData;
    } catch (error) {
      this.logger.error('Error migrating appraisal:', error);
      throw error;
    }
  }
}

module.exports = MigrationService; 