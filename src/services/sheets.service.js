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

      // Parse and validate service account credentials
      let credentials;
      try {
        credentials = JSON.parse(config.SERVICE_ACCOUNT_JSON);
        
        // Validate required fields
        const requiredFields = ['client_email', 'private_key', 'project_id'];
        const missingFields = requiredFields.filter(field => !credentials[field]);
        
        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        this.logger.info('Service account credentials validated', {
          projectId: credentials.project_id,
          clientEmail: credentials.client_email
        });
      } catch (error) {
        this.logger.error('Service account validation failed:', error);
        throw new Error(`Invalid service account configuration: ${error.message}`);
      }

      // Create JWT auth client
      this.auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // Test auth with retries
      let authError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.logger.info(`Attempting JWT authorization (attempt ${attempt}/3)...`);
          await this.auth.authorize();
          this.logger.info('JWT authorization successful');
          break;
        } catch (error) {
          authError = error;
          if (attempt < 3) {
            const delay = Math.min(Math.pow(2, attempt) * 1000, 10000);
            this.logger.warn(`JWT authorization failed, retrying in ${delay}ms:`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (authError) {
        throw new Error(`JWT authorization failed after 3 attempts: ${authError.message}`);
      }

      // Initialize sheets client
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth: this.auth,
        timeout: 30000,
        retry: {
          retries: 3,
          factor: 2,
          minTimeout: 2000,
          maxTimeout: 30000
        }
      });

      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;

      // Test spreadsheet access
      try {
        const response = await this.sheets.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: 'spreadsheetId,properties.title'
        });

        const title = response.data.properties.title;
        this.logger.info(`Successfully connected to spreadsheet: ${title}`);
        
        this.initialized = true;
        this.logger.info('Google Sheets service initialized successfully');
      } catch (error) {
        const details = error.response?.data?.error || error;
        throw new Error(`Failed to access spreadsheet: ${details.message || error.message}`);
      }
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