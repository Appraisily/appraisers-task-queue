const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
    this.spreadsheetId = null;
    this.pendingSheetName = 'Pending Appraisals';
    this.completedSheetName = 'Completed Appraisals';
    this.initialized = false;
  }

  async initialize(config) {
    if (this.initialized) return;

    try {
      // Clean up spreadsheet ID by removing any whitespace and newlines
      this.spreadsheetId = config.PENDING_APPRAISALS_SPREADSHEET_ID
        .trim()
        .replace(/[\n\r]/g, '');
      
      if (!this.spreadsheetId) {
        throw new Error('Spreadsheet ID not found in config');
      }

      this.logger.info('Creating Google Auth client with ADC...');
      
      // Initialize with Application Default Credentials
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const authClient = await auth.getClient();
      
      // Initialize sheets client
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth: authClient,
        timeout: 30000, // 30 seconds timeout
        retry: {
          retries: 3,
          statusCodesToRetry: [[100, 199], [429, 429], [500, 599]]
        }
      });

      // Test connection
      this.logger.info(`Testing connection to spreadsheet ${this.spreadsheetId}`);
      
      try {
        const response = await this.sheets.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: 'properties.title'
        });

        this.logger.info(`Connected to spreadsheet: ${response.data.properties.title}`);
      } catch (error) {
        if (error.code === 404) {
          throw new Error(`Spreadsheet ${this.spreadsheetId} not found. Please verify the ID is correct.`);
        }
        if (error.code === 403) {
          throw new Error(`Permission denied. Please ensure the service account has access to the spreadsheet.`);
        }
        throw error;
      }

      this.initialized = true;
      this.logger.info('Sheets service initialized successfully');
    } catch (error) {
      this.logger.error('Sheets initialization failed:', error.message);
      if (error.response?.data?.error) {
        this.logger.error('API Error:', error.response.data.error);
      }
      throw error;
    }
  }

  async getValues(range, checkCompletedSheet = false) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    try {
      const sheetToUse = checkCompletedSheet ? this.completedSheetName : this.pendingSheetName;
      const fullRange = `'${sheetToUse}'!${range}`;
      this.logger.info(`Getting values from range: ${fullRange}`);

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: fullRange,
        valueRenderOption: 'UNFORMATTED_VALUE'
      });

      return response.data.values || [];
    } catch (error) {
      this.logger.error(`Error getting values from range ${range}:`, error);
      throw error;
    }
  }

  async updateValues(range, values, checkCompletedSheet = false) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    try {
      const sheetToUse = checkCompletedSheet ? this.completedSheetName : this.pendingSheetName;
      const fullRange = `'${sheetToUse}'!${range}`;
      this.logger.info(`Updating values in range: ${fullRange}`);

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: fullRange,
        valueInputOption: 'RAW',
        resource: { values }
      });
    } catch (error) {
      this.logger.error(`Error updating values in range ${range}:`, error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async moveToCompleted(rowId) {
    try {
      this.logger.info(`Moving appraisal ${rowId} to Completed Appraisals`);
      
      // Get all values from A to Q for the pending row
      const range = `A${rowId}:Q${rowId}`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.pendingSheetName}'!${range}`
      });

      if (!response.data.values || !response.data.values[0]) {
        throw new Error(`No data found for row ${rowId}`);
      }
      
      // Ensure we have exactly 17 columns (A to Q)
      const rowData = response.data.values[0];
      while (rowData.length < 17) {
        rowData.push(''); // Pad with empty values if needed
      }

      // First, get the last row number of the Completed sheet
      const completedResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.completedSheetName}'!A:A`
      });

      // Calculate the next empty row (length + 1 since array is 0-based)
      const nextRow = (completedResponse.data.values?.length || 0) + 1;

      // Update the specific row in Completed Appraisals
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.completedSheetName}'!A${nextRow}:Q${nextRow}`,
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });

      // Delete the row from Pending Appraisals
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: await this.getSheetId(this.pendingSheetName),
                dimension: 'ROWS',
                startIndex: rowId - 1,
                endIndex: rowId
              }
            }
          }]
        }
      });

      this.logger.info(`Successfully moved appraisal ${rowId} to Completed Appraisals`);
    } catch (error) {
      this.logger.error(`Error moving appraisal ${rowId} to Completed:`, error);
      throw error;
    }
  }

  async getSheetId(sheetName) {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties'
    });

    const sheet = response.data.sheets.find(
      s => s.properties.title === sheetName
    );

    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    return sheet.properties.sheetId;
  }
}

module.exports = SheetsService;