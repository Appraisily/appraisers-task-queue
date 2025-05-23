const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.logger = createLogger('PDFService');
    // Initialize immediately in constructor
    this.initialized = true;
    // Determine PDF backend URL. Prefer runtime variable but fall back to the default Cloud Run deployment
    const envUrl = process.env.PDF_BACKEND_URL;

    if (envUrl && envUrl.trim()) {
      // Ensure we point to the correct endpoint (append /render-pdf when needed)
      this.pdfServiceUrl = envUrl.trim().endsWith('/render-pdf')
        ? envUrl.trim()
        : `${envUrl.trim().replace(/\/$/, '')}/render-pdf`;
    } else {
      // Default Cloud Run service URL
      this.pdfServiceUrl = 'https://pdf-backend-856401495068.us-central1.run.app/render-pdf';
    }
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
    this.logger.info(`Generating PDF for post ${postId}`);
    
    // Use a longer timeout for PDF generation (900 seconds/15 minutes)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900000);
    
    try {
      // Use timeout and better error handling
      const response = await fetch(this.pdfServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
        signal: controller.signal,
        timeout: 900000 // 15 minute timeout
      });

      // Clear the timeout if the response comes back before timeout
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error details available');
        this.logger.error(`PDF generation returned non-OK status: ${response.status}, details: ${errorText}`);
        throw new Error(`PDF generation failed with status: ${response.status}`);
      }

      const data = await response.json();
      
      // Map new response keys to legacy ones expected by the rest of the codebase
      const pdfUrl = data.pdfUrl || data.pdfLink; // Support transitional keys
      const htmlUrl = data.htmlUrl || data.docLink;

      // Validate we have actual URLs, not placeholders
      if (!pdfUrl || pdfUrl.includes('placeholder') ||
          !htmlUrl || htmlUrl.includes('placeholder')) {
        this.logger.error(`PDF generation returned invalid URLs: ${JSON.stringify(data)}`);
        throw new Error(`PDF generation returned invalid or placeholder URLs`);
      }
      
      this.logger.info(`PDF generated successfully for post ${postId}: ${pdfUrl}`);
      
      return {
        pdfLink: pdfUrl,
        docLink: htmlUrl // We keep the legacy name 'docLink' for compatibility (stores HTML link now)
      };
    } catch (error) {
      // Don't swallow the error - let it propagate to stop the process
      if (error.name === 'AbortError') {
        this.logger.error(`PDF generation for post ${postId} timed out after 900 seconds`);
        throw new Error(`PDF generation timed out after 900 seconds`);
      }
      
      this.logger.error(`PDF generation failed for post ${postId}: ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = PDFService;