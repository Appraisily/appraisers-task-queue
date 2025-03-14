const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

/**
 * Service for generating PDF reports for appraisals
 */
class PDFService {
  constructor() {
    this.logger = createLogger('PDFService');
    this.initialized = false;
    this.pdfServiceUrl = 'https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf';
    this.timeout = 240000; // 4 minutes timeout
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds between retries
  }

  /**
   * Initialize the PDF service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Test the PDF service endpoint
      const response = await fetch(this.pdfServiceUrl, {
        method: 'HEAD'
      });

      if (!response.ok) {
        throw new Error('PDF service endpoint not available');
      }

      this.initialized = true;
      this.logger.info('PDF service initialized successfully');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize PDF service:', error);
      throw error;
    }
  }

  /**
   * Check if the service is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Generate a PDF for the specified WordPress post
   * @param {string} postId - WordPress post ID
   * @param {string} sessionId - Optional session ID
   * @returns {Promise<{pdfLink: string, docLink: string}>}
   */
  async generatePDF(postId, sessionId) {
    if (!this.initialized) {
      throw new Error('PDF service not initialized');
    }

    this.logger.info(`Generating PDF for post ${postId}`);
    
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(this.pdfServiceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId, session_ID: sessionId }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`PDF generation failed: ${response.statusText}`);
        }

        const data = await response.json();
        this.logger.info(`PDF generated successfully for post ${postId}`);
        
        return {
          pdfLink: data.pdfLink,
          docLink: data.docLink
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`PDF generation attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    this.logger.error(`PDF generation failed after ${this.maxRetries} attempts:`, lastError);
    throw new Error(`PDF generation failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }
}

module.exports = PDFService;