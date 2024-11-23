const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
    this.spreadsheetId = null;
    this.initialized = false;
    this.auth = null;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing Google Sheets service...');

      if (!config.PENDING_APPRAISALS_SPREADSHEET_ID) {
        throw new Error('Spreadsheet ID not found');
      }

      this.logger.info('Creating Google Auth client with ADC...');
      
      // Use Application Default Credentials
      this.auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
      });

      // Get the client using ADC and log the email
      const client = await this.auth.getClient();
      const email = await this.auth.getCredentials()
        .then(creds => creds.client_email)
        .catch(() => 'Unable to get client email');
      
      this.logger.info('Using service account:', { email });

      // Initialize sheets client with ADC
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth: client,
        timeout: 30000,
        retry: {
          retries: 5,
          factor: 2,
          minTimeout: 2000,
          maxTimeout: 30000
        }
      });

      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;

      // Test spreadsheet access with retries
      let lastError;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          this.logger.info(`Testing sheets connection (attempt ${attempt}/5)...`, {
            spreadsheetId: this.spreadsheetId
          });
          
          const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: 'spreadsheetId,properties.title'
          });

          const title = response.data.properties.title;
          this.logger.info(`Successfully connected to spreadsheet: ${title}`, {
            spreadsheetId: this.spreadsheetId,
            title
          });
          
          this.initialized = true;
          this.logger.info('Google Sheets service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          const details = error.response?.data?.error || error;
          
          // Enhanced error logging
          this.logger.error('Sheets connection attempt failed:', {
            attempt,
            spreadsheetId: this.spreadsheetId,
            error: details.message || error.message,
            code: details.code || error.code,
            status: details.status,
            reason: details.errors?.[0]?.reason,
            domain: details.errors?.[0]?.domain,
            debugInfo: details.debugInfo,
            email
          });

          if (attempt < 5) {
            const delay = Math.min(Math.pow(2, attempt) * 2000, 30000);
            this.logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      const errorDetails = lastError.response?.data?.error || lastError;
      throw new Error(`Failed to access spreadsheet after 5 attempts: ${errorDetails.message || lastError.message}`);
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize Sheets service:', {
        error: error.message,
        code: error.code,
        details: error.details || {},
        stack: error.stack
      });
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
      this.logger.error(`Error getting values from range ${range}:`, {
        error: error.message,
        details: error.response?.data?.error || {},
        stack: error.stack
      });
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
      this.logger.error(`Error updating values in range ${range}:`, {
        error: error.message,
        details: error.response?.data?.error || {},
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = SheetsService;