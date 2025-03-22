const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const worker = require('./worker');

const logger = createLogger('App');
const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal} signal. Starting graceful shutdown...`);
  
  try {
    await worker.shutdown();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers with longer timeout
const SHUTDOWN_TIMEOUT = 60000; // 60 seconds
process.on('SIGTERM', () => {
  const shutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  
  // Clear the timeout if shutdown completes normally
  shutdown('SIGTERM').finally(() => clearTimeout(shutdownTimer));
});

process.on('SIGINT', () => {
  const shutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  
  // Clear the timeout if shutdown completes normally
  shutdown('SIGINT').finally(() => clearTimeout(shutdownTimer));
});

// Start server and initialize worker
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  
  try {
    await worker.initialize();
    logger.info('Worker initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize worker:', error);
    process.exit(1);
  }
});