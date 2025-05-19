// taskQueueService.js
const { createLogger } = require('../utils/logger');
const AppraisalService = require('./appraisal.service');

const logger = createLogger('TaskQueueService');
let appraisalService = null;

/**
 * Initializes the TaskQueueService with required dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.sheetsService - Google Sheets service
 * @param {Object} deps.config - Configuration object
 */
function initialize(deps) {
  if (!deps.sheetsService) {
    throw new Error('SheetsService is required for TaskQueueService');
  }
  
  appraisalService = new AppraisalService({
    sheetsService: deps.sheetsService,
    wordpressService: deps.wordpressService,
    openaiService: deps.openaiService,
    crmService: deps.crmService,
    pdfService: deps.pdfService,
    config: deps.config
  });
  
  logger.info('TaskQueueService initialized');
}

/**
 * Process a task from the queue
 * @param {string} id - Appraisal ID
 * @param {string} appraisalValue - Value of the appraisal
 * @param {string} description - Description of the item
 * @param {string} taskId - ID of the task being processed
 * @returns {Promise<Object>} Result of the processing
 */
async function processTask(id, appraisalValue, description, taskId) {
  if (!appraisalService) {
    throw new Error('TaskQueueService not initialized. Call initialize() first.');
  }
  
  logger.info(`Processing task ${taskId} for appraisal ${id}`);
  
  if (!id || !appraisalValue || !description) {
    throw new Error('Missing required parameters for task processing');
  }
  
  try {
    // Determine which sheet the appraisal is in
    const sheet = await appraisalService.findAppraisalSheet(id);
    
    // Process the appraisal
    const result = await appraisalService.processAppraisal(id, appraisalValue, description, sheet);
    
    logger.info(`Task ${taskId} completed successfully for appraisal ${id}`);
    return result;
  } catch (error) {
    logger.error(`Error processing task ${taskId} for appraisal ${id}:`, error);
    throw error;
  }
}

module.exports = {
  initialize,
  processTask
}; 