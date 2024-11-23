const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
    this.spreadsheetId = null;
    this.initialized = false;
  }

  async initialize(config) {
    if (this.initialized) return;

    try {
      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;
      if (!this.spreadsheetId) {
        throw new Error('Spreadsheet ID not found in config');
      }

      // Simple ADC initialization
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // Initialize sheets client
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth
      });

      // Quick test
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'properties.title'
      });

      this.initialized = true;
      this.logger.info('Sheets service initialized');
    } catch (error) {
      this.logger.error('Sheets initialization failed:', error.message);
      throw error;
    }
  }

  async getValues(range) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });

    return response.data.values || [];
  }

  async updateValues(range, values) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values }
    });
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = SheetsService;