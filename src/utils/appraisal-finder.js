/**
 * Utility for finding appraisal data across both pending and completed sheets
 */
const { createLogger } = require('./logger');

/**
 * AppraisalFinder - A utility class to locate and retrieve appraisal data
 * regardless of whether it's in the pending or completed sheets
 */
class AppraisalFinder {
  constructor(sheetsService) {
    this.logger = createLogger('AppraisalFinder');
    this.sheetsService = sheetsService;
    this.appraisalLocationCache = new Map(); // Cache to remember which sheet an appraisal is in
  }

  /**
   * Find appraisal data in either pending or completed sheet
   * @param {string|number} id - Appraisal ID
   * @param {string} range - Cell range to fetch (e.g., "A1:G1" or "J1")
   * @returns {Promise<{data: any[][], usingCompletedSheet: boolean}>} The data and which sheet it was found in
   * @throws {Error} If the appraisal cannot be found in either sheet
   */
  async findAppraisalData(id, range) {
    this.logger.debug(`Searching for appraisal ${id} in range ${range}`);
    
    // Check cache first
    const cacheKey = `appraisal-${id}`;
    if (this.appraisalLocationCache.has(cacheKey)) {
      const usingCompletedSheet = this.appraisalLocationCache.get(cacheKey);
      
      try {
        const data = await this.sheetsService.getValues(`${range.replace(/\d+/g, id)}`, usingCompletedSheet);
        if (data && data[0]) {
          return { data, usingCompletedSheet };
        }
        // If we get here, the cache is stale
        this.logger.debug(`Refreshing stale cache for appraisal ${id}`);
        this.appraisalLocationCache.delete(cacheKey);
      } catch (error) {
        this.logger.error(`Error fetching from cached location`, error);
        this.appraisalLocationCache.delete(cacheKey);
      }
    }
    
    // First try to get data from pending sheet
    let data = await this.sheetsService.getValues(`${range.replace(/\d+/g, id)}`);
    let usingCompletedSheet = false;
    
    // If data not found in pending sheet, check completed sheet
    if (!data || !data[0]) {
      try {
        data = await this.sheetsService.getValues(`${range.replace(/\d+/g, id)}`, true); // true = check completed sheet
        if (data && data[0]) {
          usingCompletedSheet = true;
          this.appraisalLocationCache.set(cacheKey, true); // Cache the location
        }
      } catch (error) {
        this.logger.error(`Error checking completed sheet`, error);
        // Continue execution even if completed sheet check fails
      }
    } else {
      this.appraisalLocationCache.set(cacheKey, false); // Cache the location
    }
    
    if (!data || !data[0]) {
      throw new Error(`No data found for appraisal ${id} in range ${range} in either sheet`);
    }
    
    return { data, usingCompletedSheet };
  }
  
  /**
   * Check if an appraisal exists in either sheet
   * @param {string|number} id - Appraisal ID
   * @returns {Promise<{exists: boolean, usingCompletedSheet: boolean}>} Whether the appraisal exists and which sheet it's in
   */
  async appraisalExists(id) {
    try {
      // Check cache first
      const cacheKey = `appraisal-${id}`;
      if (this.appraisalLocationCache.has(cacheKey)) {
        const usingCompletedSheet = this.appraisalLocationCache.get(cacheKey);
        // Verify the cached location is still valid
        const data = await this.sheetsService.getValues(`A${id}`, usingCompletedSheet);
        if (data && data[0]) {
          return { exists: true, usingCompletedSheet };
        }
        // If we get here, the cache is stale
        this.appraisalLocationCache.delete(cacheKey);
      }
      
      // Check if row exists in pending sheet first
      let data = await this.sheetsService.getValues(`A${id}`);
      if (data && data[0]) {
        this.appraisalLocationCache.set(cacheKey, false);
        return { exists: true, usingCompletedSheet: false };
      }
      
      // If not in pending, check completed sheet
      data = await this.sheetsService.getValues(`A${id}`, true);
      if (data && data[0]) {
        this.appraisalLocationCache.set(cacheKey, true);
        return { exists: true, usingCompletedSheet: true };
      }
   
      return { exists: false, usingCompletedSheet: false };
    } catch (error) {
      this.logger.error(`Error checking if appraisal exists`, error);
      return { exists: false, usingCompletedSheet: false };
    }
  }
  
  /**
   * Get full row data for an appraisal
   * @param {string|number} id - Appraisal ID
   * @param {string} columnRange - Column range (e.g., "A:G" or "B:L")
   * @returns {Promise<{data: any[][], usingCompletedSheet: boolean}>} Full row data and which sheet it was found in
   */
  async getFullRow(id, columnRange) {
    return this.findAppraisalData(id, `${columnRange}${id}`);
  }
  
  /**
   * Get multiple data points for an appraisal at once
   * @param {string|number} id - Appraisal ID
   * @param {string[]} columns - Array of column letters or ranges (e.g., ["A", "J:K"])
   * @param {boolean} usingCompletedSheet - Flag indicating which sheet the appraisal is in (determined by caller)
   * @returns {Promise<{data: Object, usingCompletedSheet: boolean}>} Object with column values and which sheet it was found in
   * @throws {Error} If the appraisal data cannot be found in the specified sheet
   */
  async getMultipleFields(id, columns, usingCompletedSheet) {
    // Create a full range (A:Z) to fetch the entire potential row data efficiently
    const fullRange = `A${id}:Z${id}`;
    
    // Use findAppraisalData which will utilize the cache if possible, but target the specified sheet
    // Note: findAppraisalData needs to be slightly adjusted or we directly call sheetsService.getValues
    // Let's call sheetsService.getValues directly here for simplicity, as findAppraisalData logic
    // is primarily for *finding* the sheet, which we've already done.
    let data;
    try {
      data = await this.sheetsService.getValues(fullRange, usingCompletedSheet);
    } catch (error) {
        this.logger.error(`Error fetching range ${fullRange}`, error);
        throw new Error(`Failed to fetch data for appraisal ${id} from the specified sheet.`);
    }
    
    if (!data || !data[0]) {
      // This case should ideally not happen if appraisalExists passed before calling this function,
      // but could occur due to race conditions or delays.
      this.logger.error(`No data found for appraisal ${id} despite prior existence check`);
      throw new Error(`No data found for appraisal ${id} in the specified sheet.`);
    }
    
    // Create result object with column-value pairs
    const result = {};
    const row = data[0];
    
    // Map column letters to array indices (A=0, B=1, etc.)
    const columnToIndex = (col) => {
      if (col.length !== 1 || col < 'A' || col > 'Z') {
        this.logger.error(`Invalid column specified: ${col}`);
        throw new Error(`Invalid column specified: ${col}`);
      }
      return col.charCodeAt(0) - 65; // 'A' is 65 in ASCII
    };
    
    // Process each requested column
    for (const column of columns) {
      try {
        if (column.includes(':')) {
          // Handle ranges like "J:K"
          const [start, end] = column.split(':');
          const startIdx = columnToIndex(start);
          const endIdx = columnToIndex(end);
          
          if (startIdx > endIdx) {
             throw new Error(`Invalid range specified: ${column}`);
          }
          
          for (let i = startIdx; i <= endIdx; i++) {
            const colLetter = String.fromCharCode(65 + i);
            result[colLetter] = row[i] !== undefined ? row[i] : null;
          }
        } else {
          // Handle single columns like "J"
          const idx = columnToIndex(column);
          result[column] = row[idx] !== undefined ? row[idx] : null;
        }
      } catch (parseError) {
         this.logger.error(`Error processing column/range "${column}"`, parseError);
         // Assign null or re-throw depending on desired behavior for invalid columns
         result[column] = null; 
      }
    }
    
    // Return data along with the sheet flag that was used
    return { data: result, usingCompletedSheet }; 
  }
}

module.exports = AppraisalFinder; 