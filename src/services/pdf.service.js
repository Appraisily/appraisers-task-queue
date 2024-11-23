const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.logger = createLogger('PDFService');
    this.initialized = false;
    this.pdfServiceUrl = 'https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf';
  }

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
      this.logger.info('PDF service initialized');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize PDF service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async generatePDF(postId, sessionId) {
    if (!this.initialized) {
      throw new Error('PDF service not initialized');
    }

    try {
      this.logger.info(`Generating PDF for post ${postId}`);
      
      const response = await fetch(this.pdfServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, session_ID: sessionId })
      });

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
      this.logger.error(`Error generating PDF for post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = PDFService;