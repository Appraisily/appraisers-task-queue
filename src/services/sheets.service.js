const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
    this.spreadsheetId = null;
    this.auth = null;
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

      let credentials;
      try {
        credentials = JSON.parse(config.SERVICE_ACCOUNT_JSON);
        this.logger.info('Service account credentials parsed successfully', {
          type: credentials.type,
          project_id: credentials.project_id,
          client_email: credentials.client_email
        });
      } catch (error) {
        this.logger.error('Failed to parse service account credentials:', {
          error: error.message,
          rawLength: config.SERVICE_ACCOUNT_JSON?.length,
          stack: error.stack
        });
        throw new Error('Invalid service account credentials format');
      }

      // Validate required credential fields
      const requiredFields = ['client_email', 'private_key', 'project_id'];
      const missingFields = requiredFields.filter(field => !credentials[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields in service account credentials: ${missingFields.join(', ')}`);
      }

      this.logger.info('Creating Google Auth client...');
      
      // Create auth client with explicit credentials
      this.auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
          project_id: credentials.project_id
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.logger.info('Initializing Google Sheets client...');
      
      // Initialize sheets with more generous timeouts
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth: this.auth,
        timeout: 30000,
        retry: {
          retries: 5,
          factor: 2,
          minTimeout: 2000,
          maxTimeout: 30000
        }
      });

      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;

      // Test connection with improved error handling
      let lastError;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          this.logger.info(`Testing sheets connection (attempt ${attempt}/5)...`, {
            spreadsheetId: this.spreadsheetId,
            clientEmail: credentials.client_email
          });

          // First verify auth
          const authClient = await this.auth.getClient();
          const projectId = await this.auth.getProjectId();
          
          this.logger.info('Auth client created successfully', {
            projectId,
            tokenScopes: (await authClient.getCredentials()).scopes
          });

          // Then verify spreadsheet access
          const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: 'spreadsheetId,properties.title'
          });

          // Verify read/write permissions by attempting to read a cell
          await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: 'A1',
            valueRenderOption: 'UNFORMATTED_VALUE'
          });

          const title = response.data.properties.title;
          this.logger.info(`Successfully connected to spreadsheet: ${title}`, {
            spreadsheetId: this.spreadsheetId,
            clientEmail: credentials.client_email
          });
          
          this.initialized = true;
          this.logger.info('Google Sheets service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          const errorDetails = {
            message: error.message,
            code: error.code,
            status: error.status,
            details: error.errors || [],
            attempt,
            clientEmail: credentials.client_email,
            spreadsheetId: this.spreadsheetId
          };
          
          this.logger.error('Sheets connection attempt failed:', errorDetails);

          if (attempt < 5) {
            const delay = Math.min(Math.pow(2, attempt) * 2000, 30000);
            this.logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw new Error(`Failed to initialize Sheets after 5 attempts: ${lastError.message}`);
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize Sheets service:', {
        error: error.message,
        stack: error.stack,
        details: error.details || {}
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
        details: error.errors || []
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
        details: error.errors || []
      });
      throw error;
    }
  }
}

module.exports = SheetsService;