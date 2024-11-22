const { google } = require('googleapis');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
  }

  async initialize() {
    try {
      if (!config.SERVICE_ACCOUNT_JSON) {
        throw new Error('Service account credentials not found');
      }

      if (!config.PENDING_APPRAISALS_SPREADSHEET_ID) {
        throw new Error('Spreadsheet ID not found');
      }

      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(config.SERVICE_ACCOUNT_JSON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID;
      
      // Verify access by attempting to read sheet metadata
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      this.logger.info('Google Sheets service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Sheets service:', error);
      throw error;
    }
  }

  async getValues(range) {
    try {
      if (!this.sheets || !this.spreadsheetId) {
        throw new Error('Sheets service not initialized');
      }

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range
      });

      return response.data.values || [];
    } catch (error) {
      this.logger.error(`Error getting values from range ${range}:`, error);
      throw error;
    }
  }

  async updateValues(range, values) {
    try {
      if (!this.sheets || !this.spreadsheetId) {
        throw new Error('Sheets service not initialized');
      }

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

  async appendValues(range, values) {
    try {
      if (!this.sheets || !this.spreadsheetId) {
        throw new Error('Sheets service not initialized');
      }

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: values
        }
      });

      this.logger.info(`Successfully appended values to range ${range}`);
    } catch (error) {
      this.logger.error(`Error appending values to range ${range}:`, error);
      throw error;
    }
  }
}

module.exports = new SheetsService();