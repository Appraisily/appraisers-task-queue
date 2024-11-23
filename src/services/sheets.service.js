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

      // Validate configuration with detailed logging
      if (!config.SERVICE_ACCOUNT_JSON) {
        this.logger.error('Service account credentials missing');
        throw new Error('Service account credentials not found');
      }

      if (!config.PENDING_APPRAISALS_SPREADSHEET_ID) {
        this.logger.error('Spreadsheet ID missing');
        throw new Error('Spreadsheet ID not found');
      }

      this.logger.info(`Using spreadsheet ID: ${config.PENDING_APPRAISALS_SPREADSHEET_ID}`);

      let credentials;
      try {
        this.logger.info('Parsing service account credentials...');
        credentials = JSON.parse(config.SERVICE_ACCOUNT_JSON);
        
        // Log important credential fields (excluding sensitive data)
        this.logger.info('Credential validation:', {
          type: credentials.type,
          project_id: credentials.project_id,
          client_email: credentials.client_email,
          has_private_key: !!credentials.private_key
        });
      } catch (error) {
        this.logger.error('Failed to parse service account credentials:', {
          error: error.message,
          type: typeof config.SERVICE_ACCOUNT_JSON,
          length: config.SERVICE_ACCOUNT_JSON?.length
        });
        throw new Error(`Invalid service account credentials format: ${error.message}`);
      }

      this.logger.info('Creating Google Auth client...');
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.logger.info('Initializing Google Sheets client...');
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth,
        timeout: 10000,
        retry: {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 10000
        }
      });

      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;
      
      // Test connection with retries
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.logger.info(`Testing sheets connection (attempt ${attempt}/3)...`, {
            spreadsheetId: this.spreadsheetId
          });
          
          const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: 'spreadsheetId,properties.title'
          });

          const title = response.data.properties.title;
          this.logger.info('Spreadsheet connection successful:', {
            title,
            spreadsheetId: response.data.spreadsheetId
          });
          
          this.initialized = true;
          this.logger.info('Google Sheets service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          
          // Extract detailed error information
          const errorDetails = {
            message: error.message,
            code: error.code,
            status: error.status,
            errors: error.errors,
            attempt,
            response: error.response?.data,
            stack: error.stack
          };
          
          // Log the full error details
          this.logger.error('Sheets connection attempt failed:', {
            ...errorDetails,
            auth: {
              type: credentials.type,
              email: credentials.client_email,
              scopes: ['https://www.googleapis.com/auth/spreadsheets']
            }
          });

          if (attempt < 3) {
            const delay = Math.pow(2, attempt) * 1000;
            this.logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      const finalError = new Error(`Failed to initialize Sheets after 3 attempts: ${lastError.message}`);
      finalError.details = {
        originalError: lastError,
        spreadsheetId: this.spreadsheetId,
        clientEmail: credentials.client_email
      };
      throw finalError;
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize Sheets service:', {
        error: {
          message: error.message,
          stack: error.stack,
          details: error.details || {},
          response: error.response?.data,
          code: error.code
        },
        spreadsheetId: this.spreadsheetId
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

      this.logger.info(`Successfully retrieved ${response.data.values?.length || 0} rows from range ${range}`);
      return response.data.values || [];
    } catch (error) {
      this.logger.error(`Error getting values from range ${range}:`, {
        error: {
          message: error.message,
          code: error.code,
          status: error.status,
          errors: error.errors || [],
          response: error.response?.data
        },
        range,
        spreadsheetId: this.spreadsheetId
      });
      throw error;
    }
  }

  async updateValues(range, values) {
    if (!this.initialized) {
      throw new Error('Sheets service not initialized');
    }

    try {
      this.logger.info(`Updating values in range: ${range}`, {
        rowCount: values.length,
        columnCount: values[0]?.length
      });
      
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
        error: {
          message: error.message,
          code: error.code,
          status: error.status,
          errors: error.errors || [],
          response: error.response?.data
        },
        range,
        spreadsheetId: this.spreadsheetId,
        valueCount: values.length
      });
      throw error;
    }
  }
}

module.exports = SheetsService;