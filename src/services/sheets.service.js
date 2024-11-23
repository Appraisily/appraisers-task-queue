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

      if (!config.PENDING_APPRAISALS_SPREADSHEET_ID) {
        throw new Error('Spreadsheet ID not found in config');
      }

      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;
      
      // Log the spreadsheet ID we're trying to use
      this.logger.info(`Using spreadsheet ID: ${this.spreadsheetId}`);

      // Create auth client with ADC
      this.logger.info('Creating Google Auth client with ADC...');
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // Get the client email for logging
      const client = await auth.getClient();
      const clientEmail = await client.getCredentials()
        .then(creds => creds.client_email)
        .catch(() => 'unknown');
      
      this.logger.info('Using service account:', clientEmail);

      // Initialize sheets client
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth
      });

      // Test connection with detailed error logging
      let lastError;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          this.logger.info(`Testing sheets connection (attempt ${attempt}/5)...`);
          
          const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: 'properties.title'
          }).catch(err => {
            // Log the full error details
            this.logger.error('API Error Details:', {
              code: err.code,
              message: err.message,
              status: err.status,
              details: err.response?.data?.error,
              stack: err.stack
            });
            throw err;
          });

          const title = response.data.properties.title;
          this.logger.info(`Successfully connected to spreadsheet: ${title}`);
          
          this.initialized = true;
          this.logger.info('Google Sheets service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          this.logger.error(`Connection attempt ${attempt} failed:`, {
            error: error.message,
            code: error.code,
            status: error.status,
            details: error.response?.data?.error
          });

          if (attempt < 5) {
            const delay = Math.min(Math.pow(2, attempt) * 2000, 30000);
            this.logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError;
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
      this.logger.info(`Getting values from range: ${range}`);
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });

      this.logger.info(`Successfully retrieved ${response.data.values?.length || 0} rows`);
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
      this.logger.info(`Updating values in range: ${range}`);
      
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