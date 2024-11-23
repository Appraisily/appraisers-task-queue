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
      
      this.logger.info(`Using spreadsheet ID: ${this.spreadsheetId}`);

      // Create auth client with ADC and explicit project ID
      this.logger.info('Creating Google Auth client with ADC...');
      const auth = new google.auth.GoogleAuth({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // Initialize sheets client with shorter timeout
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth,
        timeout: 10000, // 10 seconds timeout
        retry: {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000
        }
      });

      // Test connection with shorter timeout and fewer retries
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.logger.info(`Testing sheets connection (attempt ${attempt}/3)...`);
          
          const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: 'properties.title',
            timeout: 5000 // 5 seconds timeout for test
          });

          const title = response.data.properties.title;
          this.logger.info(`Successfully connected to spreadsheet: ${title}`);
          
          this.initialized = true;
          this.logger.info('Google Sheets service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          const errorDetails = {
            code: error.code,
            message: error.message,
            status: error.status,
            details: error.response?.data?.error
          };
          
          this.logger.error(`Connection attempt ${attempt} failed:`, errorDetails);

          if (attempt < 3) {
            const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
            this.logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw new Error(`Failed to initialize Sheets after 3 attempts: ${lastError?.message}`);
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
        dateTimeRenderOption: 'FORMATTED_STRING',
        timeout: 5000
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
        resource: { values },
        timeout: 5000
      });

      this.logger.info(`Successfully updated values in range ${range}`);
    } catch (error) {
      this.logger.error(`Error updating values in range ${range}:`, error);
      throw error;
    }
  }
}

module.exports = SheetsService;