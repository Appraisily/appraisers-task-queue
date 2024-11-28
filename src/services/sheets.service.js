const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');

class SheetsService {
  constructor() {
    this.logger = createLogger('SheetsService');
    this.sheets = null;
    this.spreadsheetId = null;
    this.pendingSheet = 'Pending Appraisals';
    this.completedSheet = 'Completed Appraisals';
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

  async getValues(range, sheetName = this.pendingSheet) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    try {
      const fullRange = `'${sheetName}'!${range}`;
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

  async updateValues(range, values, sheetName = this.pendingSheet) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    try {
      const fullRange = `'${sheetName}'!${range}`;
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

  async moveAppraisalToCompleted(id) {
    try {
      this.logger.info(`Moving appraisal ${id} to Completed Appraisals sheet`);

      // Get the entire row from Pending Appraisals
      const rowRange = `A${id}:Q${id}`;
      const [rowData] = await this.getValues(rowRange, this.pendingSheet);

      if (!rowData) {
        throw new Error(`No data found for appraisal ${id}`);
      }

      // Get the last row in Completed Appraisals
      const completedMetadata = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        ranges: [`'${this.completedSheet}'!A:A`],
        fields: 'sheets.properties'
      });

      const lastRow = completedMetadata.data.sheets[0].properties.gridProperties.rowCount + 1;

      // Add the row to Completed Appraisals at the end
      await this.updateValues(`A${lastRow}:Q${lastRow}`, [rowData], this.completedSheet);
      this.logger.info(`Added appraisal to Completed Appraisals at row ${lastRow}`);

      // Clear the row from Pending Appraisals
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: await this.getSheetId(this.pendingSheet),
                dimension: 'ROWS',
                startIndex: id - 1,
                endIndex: id
              }
            }
          }]
        }
      });

      this.logger.info(`Removed appraisal from Pending Appraisals row ${id}`);
    } catch (error) {
      this.logger.error(`Error moving appraisal ${id} to completed:`, error);
      throw error;
    }
  }

  async getSheetId(sheetName) {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties'
    });

    const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    return sheet.properties.sheetId;
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = SheetsService;