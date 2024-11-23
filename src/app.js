const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const core = require('./core');
const { shutdownPubSub } = require('./core/pubsub');

const logger = createLogger('App');
const app = express();
let isInitialized = false;
let initializationError = null;

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

// Start server and initialize services
async function startServer() {
  const PORT = process.env.PORT || 8080;

  // Start HTTP server immediately
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Task Queue service running on port ${PORT}`);
  });

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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal. Starting graceful shutdown...');
  await shutdownPubSub();
  process.exit(0);
});

// Start everything
startServer();