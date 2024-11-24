const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.logger = createLogger('PDF');
    this.pdfServiceUrl = 'https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf';
  }

  // No initialization needed for the PDF service since it's just an API endpoint
  async initialize() {
    return Promise.resolve();
  }

  async generatePDF(postId, sessionId) {
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
  }
}

module.exports = PDFService;