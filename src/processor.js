const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

let isInitialized = false;
let isShuttingDown = false;
let healthCheckInterval;

const HEALTH_CHECK_INTERVAL = 15000; // 15 seconds

async function checkServiceHealth() {
  try {
    if (isShuttingDown) return;

    console.log('Service health check: Active');
    isInitialized = true;
  } catch (error) {
    console.error('Health check failed:', error);
    isInitialized = false;
  }
}

async function initializeProcessor() {
  try {
    if (isShuttingDown) {
      console.log('Processor is shutting down, skipping initialization');
      return;
    }

    if (isInitialized) {
      console.log('Processor already initialized, skipping...');
      return;
    }

    console.log('Initializing task processor...');
    
    // Set up health check interval
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    
    healthCheckInterval = setInterval(async () => {
      await checkServiceHealth();
    }, HEALTH_CHECK_INTERVAL);
    
    console.log('Task processor is ready');
    isInitialized = true;
  } catch (error) {
    console.error('Error initializing processor:', error);
    isInitialized = false;
    throw error;
  }
}

async function processDirectTask(id, appraisalValue, description, taskId = null) {
  try {
    if (!isInitialized) {
      await initializeProcessor();
    }
    
    if (!id || !appraisalValue || !description) {
      throw new Error('Missing required task parameters');
    }
    
    console.log(`Processing direct task for appraisal ${id}`);
    
    await taskQueueService.processTask(
      id,
      appraisalValue,
      description,
      taskId || `direct-${Date.now()}`
    );
    
    console.log(`✓ Task processed successfully: ${id}`);
    return true;
  } catch (error) {
    console.error(`Error processing direct task ${id}:`, error);
    throw error;
  }
}

async function closeProcessor() {
  isShuttingDown = true;
  
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  console.log('Task processor shut down successfully');
  isInitialized = false;
}

module.exports = { 
  initializeProcessor, 
  closeProcessor,
  processDirectTask
};