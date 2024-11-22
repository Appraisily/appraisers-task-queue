const { google } = require('googleapis');
const { getSecret } = require('../utils/secretManager');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
  }

  async initialize() {
    try {
      // Use the exact secret name from service account
      const serviceAccount = await getSecret('service-account-json');
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(serviceAccount),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.logger.info('Google Sheets service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Sheets service:', error);
      throw error;
    }
  }

  // Rest of the code remains the same...
}