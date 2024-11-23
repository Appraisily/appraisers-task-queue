const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const core = require('./core');
const { shutdownPubSub } = require('./core/pubsub');

const logger = createLogger('App');
const app = express();
let isInitialized = false;
let initializationError = null;
let shuttingDown = false;

// Increase max listeners to prevent warning
process.setMaxListeners(20);

app.use(cors());
app.use(express.json());

// Health check endpoint with improved status reporting
app.get('/health', (req, res) => {
  const status = {
    status: isInitialized ? 'healthy' : initializationError ? 'error' : 'initializing',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ready: isInitialized,
    error: initializationError ? {
      message: initializationError.message,
      code: initializationError.code || 'UNKNOWN'
    } : null
  };

  // Return 200 during initialization to prevent Cloud Run from killing the container
  res.status(200).json(status);
});

// Improved shutdown handler with timeout
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal} signal. Starting graceful shutdown...`);
  
  // Set a timeout for shutdown
  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);

  try {
    await shutdownPubSub();
    logger.info('Graceful shutdown completed');
    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Start server and initialize services with improved error handling
async function startServer() {
  const PORT = process.env.PORT || 8080;

  // Start HTTP server immediately
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Task Queue service running on port ${PORT}`);
  });

  // Set server timeouts
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // Initialize core with retries
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries && !isInitialized) {
    attempt++;
    try {
      await core.initialize();
      isInitialized = true;
      logger.info('Service initialization complete');
      break;
    } catch (error) {
      initializationError = error;
      logger.error(`Service initialization attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        logger.info(`Retrying initialization in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  if (!isInitialized) {
    logger.error('Service initialization failed after all retries');
  }
}

// Register shutdown handlers with longer timeout
const shutdownSignals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
shutdownSignals.forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

// Start everything
startServer();