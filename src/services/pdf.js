const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.logger = createLogger('PDF');
    this.pdfServiceUrl = 'https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf';
  }

  async generatePDF(postId, sessionId) {
    const response = await fetch(this.pdfServiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, session_ID: sessionId })
    });

    if (!response.ok) {
      throw new Error(`PDF generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      pdfLink: data.pdfLink,
      docLink: data.docLink
    };
  }
}

module.exports = new PDFService();