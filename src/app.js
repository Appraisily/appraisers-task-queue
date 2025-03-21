const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const gcsLogger = require('./utils/gcsLogger');

const logger = createLogger('App');
const worker = require('./worker');  // Import the singleton instance

// Initialize server
const app = express();
const PORT = process.env.PORT || 8080;

// Enable JSON body parsing
app.use(express.json());

// Enable CORS for all routes
app.use(cors());

// Handle shutdown gracefully
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal} signal. Starting graceful shutdown...`);
  
  try {
    await worker.shutdown();
    // Flush any remaining logs
    await gcsLogger.flushAll();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    // Try to flush logs even if shutdown failed
    try {
      await gcsLogger.flushAll();
    } catch (logError) {
      logger.error('Error flushing logs during shutdown:', logError);
    }
    process.exit(1);
  }
};

// Forced shutdown after timeout
const forceShutdown = () => {
  logger.error('Forced shutdown after timeout');
  process.exit(1);
};

// Set up signal handlers
process.on('SIGINT', () => {
  handleShutdown('SIGINT');
  // Force shutdown after 30 seconds if graceful shutdown fails
  setTimeout(forceShutdown, 30000);
});

process.on('SIGTERM', () => {
  handleShutdown('SIGTERM');
  // Force shutdown after 30 seconds if graceful shutdown fails
  setTimeout(forceShutdown, 30000);
});

// Legacy test route for logging
app.post('/test-log', async (req, res) => {
  const { sessionId, message } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      message: 'sessionId is required'
    });
  }
  
  try {
    logger.info(`Test message: ${message || 'Hello logging!'}`, { sessionId });
    logger.s3Log(sessionId, 'info', 'Explicit log test', { timestamp: new Date().toISOString() });
    
    return res.json({
      success: true,
      message: 'Logging test executed successfully'
    });
  } catch (error) {
    logger.error('Error in logging test', error);
    return res.status(500).json({
      success: false,
      message: 'Error in logging test',
      error: error.message
    });
  }
});

// Test route for GCS logging
app.post('/test-gcs-log', async (req, res) => {
  const { sessionId, message } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      message: 'sessionId is required'
    });
  }
  
  try {
    logger.info(`GCS test message: ${message || 'Hello GCS logging!'}`, { sessionId });
    logger.s3Log(sessionId, 'info', 'Explicit GCS log test', { timestamp: new Date().toISOString() });
    
    return res.json({
      success: true,
      message: 'GCS logging test executed successfully'
    });
  } catch (error) {
    logger.error('Error in GCS logging test', error);
    return res.status(500).json({
      success: false,
      message: 'Error in GCS logging test',
      error: error.message
    });
  }
});

// Health check routes
app.get('/', (req, res) => {
  res.status(200).send('Appraisers Task Queue Service is running');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Appraisers Task Queue Service is healthy',
    timestamp: new Date().toISOString()
  });
});

// Start server and initialize worker
const server = app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  
  // Initialize worker with retries
  let retryCount = 0;
  const maxRetries = 3;
  let workerInitialized = false;

  while (retryCount < maxRetries && !workerInitialized) {
    try {
      if (retryCount > 0) {
        logger.info(`Retrying worker initialization (attempt ${retryCount + 1}/${maxRetries})...`);
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.min(5000 * Math.pow(2, retryCount), 30000)));
      }
      
      await worker.initialize();
      logger.info('Worker initialized successfully');
      workerInitialized = true;
    } catch (error) {
      retryCount++;
      logger.error('Failed to initialize worker:', error);
      
      if (retryCount >= maxRetries) {
        logger.error(`Worker initialization failed after ${maxRetries} attempts. Service will run with limited functionality.`);
        
        // Set up a timer to retry initialization periodically
        const retryIntervalMinutes = 5;
        logger.info(`Will retry worker initialization every ${retryIntervalMinutes} minutes`);
        
        setInterval(async () => {
          logger.info('Periodic retry of worker initialization...');
          try {
            await worker.initialize();
            logger.info('Worker initialized successfully on periodic retry');
            // Clear the interval once initialization succeeds
            clearInterval(this);
          } catch (error) {
            logger.error('Periodic worker initialization failed:', error);
          }
        }, retryIntervalMinutes * 60 * 1000);
      }
    }
  }
});

module.exports = { app, server };