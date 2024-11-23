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
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing Google Sheets service...');

      // Validate configuration
      if (!config.SERVICE_ACCOUNT_JSON) {
        throw new Error('Service account credentials not found');
      }
      if (!config.PENDING_APPRAISALS_SPREADSHEET_ID) {
        throw new Error('Spreadsheet ID not found');
      }

      // Parse service account credentials
      let credentials;
      try {
        credentials = JSON.parse(config.SERVICE_ACCOUNT_JSON);
        if (!credentials.client_email || !credentials.private_key) {
          throw new Error('Invalid service account format');
        }
      } catch (error) {
        throw new Error(`Failed to parse service account JSON: ${error.message}`);
      }

      // Initialize auth with explicit credentials
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
          project_id: credentials.project_id
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;

      // Test connection with retries
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: 'spreadsheetId,properties.title'
          });

          this.initialized = true;
          this.logger.info('Google Sheets service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            const delay = 1000 * Math.pow(2, attempt - 1);
            this.logger.warn(`Sheets connection attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw new Error(`Failed to connect to Google Sheets after 3 attempts: ${lastError.message}`);
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize Sheets service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async getValues(range) {
    if (!this.initialized) {
      throw new Error('Sheets service not initialized');
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });

      return response.data.values || [];
    } catch (error) {
      this.logger.error(`Error getting values from range ${range}:`, error);
      throw error;
    }
  }

  async updateValues(range, values) {
    if (!this.initialized) {
      throw new Error('Sheets service not initialized');
    }

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: values
        }
      });

      this.logger.info(`Successfully updated values in range ${range}`);
    } catch (error) {
      this.logger.error(`Error updating values in range ${range}:`, error);
      throw error;
    }
  }
}

module.exports = SheetsService;