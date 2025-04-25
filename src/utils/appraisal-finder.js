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
    this.cache = new Map(); // Cache to store appraisal location (pending vs completed)
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
    
    // Check cache first to avoid redundant lookups
    const cacheKey = `appraisal-${id}`;
    if (this.cache.has(cacheKey)) {
      const cachedInfo = this.cache.get(cacheKey);
      this.logger.info(`Using cached location for appraisal ${id}: ${cachedInfo.usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      
      try {
        // Even with known sheet, still need to get the specific data requested
        const data = await this.sheetsService.getValues(`${range.replace(/\d+/g, id)}`, cachedInfo.usingCompletedSheet);
        return { data, usingCompletedSheet: cachedInfo.usingCompletedSheet };
      } catch (error) {
        this.logger.warn(`Error using cached sheet information for ${id}, will try full lookup: ${error.message}`);
        this.cache.delete(cacheKey); // Clear invalid cache entry
      }
    }
    
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
          this.logger.info(`Found appraisal ${id} in completed sheet for range ${range}`);
        }
      } catch (error) {
        this.logger.error(`Error checking completed sheet: ${error.message}`);
        // Continue execution even if completed sheet check fails
      }
    } else {
      this.logger.info(`Found appraisal ${id} in pending sheet for range ${range}`);
    }
    
    if (!data || !data[0]) {
      throw new Error(`No data found for appraisal ${id} in range ${range} in either sheet`);
    }
    
    // Cache the result for future lookups
    this.cache.set(cacheKey, { usingCompletedSheet, timestamp: Date.now() });
    
    // Log which sheet is being used
    this.logger.info(`Using ${usingCompletedSheet ? 'completed' : 'pending'} sheet for appraisal ${id}`);
    
    return { data, usingCompletedSheet };
  }
  
  /**
   * Check if an appraisal exists in either sheet
   * @param {string|number} id - Appraisal ID
   * @returns {Promise<{exists: boolean, usingCompletedSheet: boolean}>} Whether the appraisal exists and which sheet it's in
   */
  async appraisalExists(id) {
    // Check cache first
    const cacheKey = `appraisal-${id}`;
    if (this.cache.has(cacheKey)) {
      const cachedInfo = this.cache.get(cacheKey);
      this.logger.info(`Using cached existence info for appraisal ${id}: exists in ${cachedInfo.usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      return { exists: true, usingCompletedSheet: cachedInfo.usingCompletedSheet };
    }
    
    try {
      // Check if row exists in pending sheet first
      let data = await this.sheetsService.getValues(`A${id}`);
      if (data && data[0]) {
        // Cache the result
        this.cache.set(cacheKey, { usingCompletedSheet: false, timestamp: Date.now() });
        return { exists: true, usingCompletedSheet: false };
      }
      
      // If not in pending, check completed sheet
      data = await this.sheetsService.getValues(`A${id}`, true);
      if (data && data[0]) {
        // Cache the result
        this.cache.set(cacheKey, { usingCompletedSheet: true, timestamp: Date.now() });
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
    // Check cache first to determine which sheet to check
    const cacheKey = `appraisal-${id}`;
    if (this.cache.has(cacheKey)) {
      const cachedInfo = this.cache.get(cacheKey);
      this.logger.info(`Using cached sheet info for full row retrieval of appraisal ${id}`);
      
      // Get data from the known sheet
      const data = await this.sheetsService.getValues(`${columnRange.replace(/:\w+/g, '')}${id}:${columnRange.split(':')[1]}${id}`, cachedInfo.usingCompletedSheet);
      return { data, usingCompletedSheet: cachedInfo.usingCompletedSheet };
    }
    
    // If not in cache, use the standard lookup method
    return this.findAppraisalData(id, `${columnRange}${id}`);
  }
  
  /**
   * Clear the cache for a specific appraisal or all appraisals
   * @param {string|number} [id] - Optional appraisal ID to clear from cache
   */
  clearCache(id = null) {
    if (id) {
      const cacheKey = `appraisal-${id}`;
      this.cache.delete(cacheKey);
      this.logger.info(`Cache cleared for appraisal ${id}`);
    } else {
      this.cache.clear();
      this.logger.info('Full appraisal finder cache cleared');
    }
  }
}

module.exports = AppraisalFinder; 