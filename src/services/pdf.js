const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

// DEPRECATED: This file is deprecated. Please use pdf.service.js instead.
// This file is kept for reference only and will be removed in a future update.

class PDFService {
  constructor() {
    this.logger = createLogger('PDF');
    this.baseUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
    this.timeout = 120000; // 2 minutes timeout
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds between retries
  }

  async initialize() {
    return Promise.resolve();
  }

  async generatePDF(postId, sessionId) {
    this.logger.info(`Generating PDF for post ${postId}`);
    
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${this.baseUrl}/generate-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId, session_ID: sessionId }),
          signal: controller.signal,
          timeout: this.timeout
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

    throw new Error(`PDF generation failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }
}

module.exports = PDFService;