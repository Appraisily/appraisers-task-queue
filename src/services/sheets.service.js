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
    this.debugMode = process.env.DEBUG_SHEETS === 'true';
    // Track previous operations to reduce identical log messages
    this.lastOperations = new Map();
  }

  /**
   * Debug logging method that only logs when debug mode is enabled
   * @param {string} message - Debug message
   * @param {any} data - Optional data to log
   */
  debug(message, data = null) {
    if (this.debugMode) {
      if (data) {
        this.logger.debug(`${message}`, data);
      } else {
        this.logger.debug(`${message}`);
      }
    }
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

      this.logger.info('Creating Google Auth client...');
      
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
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'properties.title'
      });

      this.logger.info(`Connected to spreadsheet: ${response.data.properties.title}`);
      this.initialized = true;
    } catch (error) {
      this.logger.error('Sheets initialization failed:', error.message);
      if (error.response?.data?.error) {
        this.logger.error('API Error:', error.response.data.error);
      }
      throw error;
    }
  }

  // Checks if we've recently performed this operation
  _shouldSkipLogging(operation, range) {
    const key = `${operation}:${range}`;
    const now = Date.now();
    const lastTime = this.lastOperations.get(key) || 0;
    
    // If we've done this operation on this range in the last 5 seconds, don't log
    if (now - lastTime < 5000) {
      return true;
    }
    
    this.lastOperations.set(key, now);
    return false;
  }

  async getValues(range, checkCompletedSheet = false) {
    if (!this.initialized) throw new Error('Sheets service not initialized');

    try {
      const sheetToUse = checkCompletedSheet ? this.completedSheetName : this.pendingSheetName;
      const fullRange = `'${sheetToUse}'!${range}`;
      
      // Only log if this isn't a repetitive call
      if (!this._shouldSkipLogging('get', fullRange)) {
        this.logger.debug(`Getting values from range: ${fullRange}`);
      }

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
      
      // First, get the current values
      const currentValues = await this.getValues(range, checkCompletedSheet);
      
      // Compare current values with new values to see if an update is needed
      let needsUpdate = true;
      
      if (currentValues && currentValues.length > 0) {
        // Check if the arrays are the same size and have the same values
        if (currentValues.length === values.length) {
          needsUpdate = false;
          
          // Compare each row
          for (let i = 0; i < values.length; i++) {
            if (!currentValues[i] || currentValues[i].length !== values[i].length) {
              needsUpdate = true;
              break;
            }
            
            // Compare each cell in the row
            for (let j = 0; j < values[i].length; j++) {
              if (currentValues[i][j] !== values[i][j]) {
                needsUpdate = true;
                break;
              }
            }
            
            if (needsUpdate) break;
          }
        }
      }
      
      // Only update if the values are different
      if (needsUpdate) {
        // Only log if this isn't a repetitive update
        if (!this._shouldSkipLogging('update', fullRange)) {
          this.logger.debug(`Updating values in range: ${fullRange}`);
        }
        
        // Pre-process all values to ensure they're compatible with Sheets API
        for (let i = 0; i < values.length; i++) {
          for (let j = 0; j < values[i].length; j++) {
            const originalValue = values[i][j];
            
            // Handle undefined values
            if (originalValue === undefined) {
              values[i][j] = '';
              continue;
            }
            
            // Handle object values - convert Promise objects to strings
            if (originalValue !== null && typeof originalValue === 'object') {
              if (originalValue instanceof Promise) {
                values[i][j] = '[object Promise]';
              } else {
                try {
                  // Try to stringify the object if possible
                  values[i][j] = JSON.stringify(originalValue);
                } catch (stringifyError) {
                  // If stringify fails, use a simple string representation
                  values[i][j] = '[object Object]';
                }
              }
              continue;
            }
            
            // Ensure boolean values are converted to strings
            if (typeof originalValue === 'boolean') {
              values[i][j] = originalValue.toString();
              continue;
            }
            
            // No need to convert strings or numbers, they're already supported
            if (typeof originalValue !== 'string' && typeof originalValue !== 'number' && originalValue !== null) {
              values[i][j] = String(originalValue);
            }
          }
        }
        
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: fullRange,
          valueInputOption: 'RAW',
          resource: { values }
        });
        
        this.logger.debug(`Updated ${fullRange}`);
      } else {
        this.logger.debug(`Skipping update for range: ${fullRange} - values unchanged`);
      }
    } catch (error) {
      this.logger.error(`Error updating values in range ${range}:`, error);
      throw new Error(`Failed to update values in range ${range}: ${error.message}`);
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

      // Instead of deleting, update the status in the Pending Appraisals sheet
      const statusUpdateRange = `F${rowId}`;
      await this.updateValues(statusUpdateRange, [['Moved to Completed']], false); // false for pendingSheetName

      this.logger.info(`Completed move of appraisal ${rowId}. Status set to 'Moved to Completed' in pending sheet.`);
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