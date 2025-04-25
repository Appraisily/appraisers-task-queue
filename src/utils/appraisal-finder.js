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
  }

  /**
   * Find appraisal data in either pending or completed sheet
   * @param {string|number} id - Appraisal ID
   * @param {string} range - Cell range to fetch (e.g., "A1:G1" or "J1")
   * @returns {Promise<{data: any[][], usingCompletedSheet: boolean}>} The data and which sheet it was found in
   * @throws {Error} If the appraisal cannot be found in either sheet
   */
  async findAppraisalData(id, range) {
    this.logger.info(`Searching for appraisal ${id} in range ${range}`);
    
    // First try to get data from pending sheet
    let data = await this.sheetsService.getValues(`${range.replace(/\d+/g, id)}`);
    let usingCompletedSheet = false;
    
    // If data not found in pending sheet, check completed sheet
    if (!data || !data[0]) {
      this.logger.info(`No data found in pending sheet for appraisal ${id}, checking completed sheet`);
      try {
        data = await this.sheetsService.getValues(`${range.replace(/\d+/g, id)}`, true); // true = check completed sheet
        if (data && data[0]) {
          usingCompletedSheet = true;
          this.logger.info(`Found appraisal ${id} in completed sheet`);
        }
      } catch (error) {
        this.logger.error(`Error checking completed sheet: ${error.message}`);
        // Continue execution even if completed sheet check fails
      }
    }
    
    if (!data || !data[0]) {
      throw new Error(`No data found for appraisal ${id} in range ${range}`);
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
      // Check if row exists in pending sheet first
      let data = await this.sheetsService.getValues(`A${id}`);
      if (data && data[0]) {
        return { exists: true, usingCompletedSheet: false };
      }
      
      // If not in pending, check completed sheet
      data = await this.sheetsService.getValues(`A${id}`, true);
      if (data && data[0]) {
        return { exists: true, usingCompletedSheet: true };
      }
      
      return { exists: false, usingCompletedSheet: false };
    } catch (error) {
      this.logger.error(`Error checking if appraisal ${id} exists:`, error);
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
}

module.exports = AppraisalFinder; 