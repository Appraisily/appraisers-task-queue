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
require('events').EventEmitter.defaultMaxListeners = 20;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  const status = {
    status: isInitialized ? 'healthy' : initializationError ? 'error' : 'initializing',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ready: isInitialized
  };

  if (initializationError) {
    status.error = initializationError.message;
    return res.status(503).json(status);
  }

  res.status(isInitialized ? 200 : 503).json(status);
});

// Graceful shutdown handler
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal} signal. Starting graceful shutdown...`);
  
  try {
    await shutdownPubSub();
    logger.info('Graceful shutdown completed');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
}

// Start server and initialize services
async function startServer() {
  const PORT = process.env.PORT || 8080;

  // Start HTTP server immediately
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Task Queue service running on port ${PORT}`);
  });

  // Set server timeouts
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // Initialize core in the background
  try {
    await core.initialize();
    isInitialized = true;
    logger.info('Service initialization complete');
  } catch (error) {
    isInitialized = false;
    initializationError = error;
    logger.error('Service initialization failed:', error);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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