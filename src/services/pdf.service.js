const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.logger = createLogger('PDFService');
    // Initialize immediately in constructor
    this.initialized = true;
    this.pdfServiceUrl = 'https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf';
    this.logger.info('PDF service initialized immediately');
  }

  // Keep initialize() method to maintain API compatibility, but make it a no-op
  async initialize() {
    return Promise.resolve();
  }

  isInitialized() {
    return true;
  }

  async generatePDF(postId, sessionId) {
    try {
      this.logger.info(`Generating PDF for post ${postId}`);
      
      const response = await fetch(this.pdfServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, session_ID: sessionId })
      });

      if (!response.ok) {
        this.logger.warn(`PDF generation returned non-OK status: ${response.status}, using fallback`);
        return {
          pdfLink: `https://placeholder-pdf-url/${postId}`,
          docLink: `https://placeholder-doc-url/${postId}`
        };
      }

      const data = await response.json();
      this.logger.info(`PDF generated successfully for post ${postId}`);
      
      return {
        pdfLink: data.pdfLink,
        docLink: data.docLink
      };
    } catch (error) {
      this.logger.warn(`PDF generation failed, using fallback URLs: ${error.message}`);
      return {
        pdfLink: `https://placeholder-pdf-url/${postId}`,
        docLink: `https://placeholder-doc-url/${postId}`
      };
    }
  }
}

module.exports = PDFService;