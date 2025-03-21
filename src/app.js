const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');

const logger = createLogger('App');
const PubSubWorker = require('./worker');

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
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
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

// Test route for logging
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

// Health check route
app.get('/', (req, res) => {
  res.status(200).send('Appraisers Task Queue Service is running');
});

// Create worker instance
const worker = new PubSubWorker();

// Start server and initialize worker
const server = app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  
  try {
    // Initialize worker
    await worker.initialize();
    logger.info('Worker initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize worker:', error);
  }
});

module.exports = { app, server };