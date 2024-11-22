const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const config = require('./config');
const { PubSubManager } = require('./services/pubSubManager');
const taskQueueService = require('./services/taskQueueService');
const serviceManager = require('./utils/serviceManager');
const secretManager = require('./utils/secretManager');
const { withRetry } = require('./utils/retry');

const logger = createLogger('app');
const app = express();
let server;

const corsOptions = {
  origin: [
    'https://appraisers-frontend-856401495068.us-central1.run.app',
    'https://jazzy-lollipop-0a3217.netlify.app',
    'https://earnest-choux-a0ec16.netlify.app',
    'https://appraisily.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint that responds immediately
app.get('/health', (req, res) => {
  const status = {
    status: 'initializing',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: serviceManager.getStatus()
  };

  // Always return 200 during initialization to prevent container restarts
  if (!serviceManager.isInitialized()) {
    status.message = 'Services are still initializing';
    return res.status(200).json(status);
  }

  // Once initialized, return actual health status
  const isHealthy = Object.values(status.services)
    .every(s => s === 'initialized');

  status.status = isHealthy ? 'healthy' : 'unhealthy';
  
  if (!isHealthy) {
    status.error = 'One or more services are not initialized';
  }

  res.status(isHealthy ? 200 : 503).json(status);
});

async function startServer() {
  return new Promise((resolve, reject) => {
    try {
      const PORT = process.env.PORT || 8080;
      server = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Task Queue service running on port ${PORT}`);
        resolve(server);
      });

      server.on('error', (error) => {
        logger.error('Server error:', error);
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function initializeServices() {
  try {
    // Start server first for health checks
    await startServer();

    // Initialize secret manager first
    await withRetry(
      () => secretManager.initialize(),
      { name: 'Secret Manager initialization', retries: 5 }
    );
    logger.info('Secret Manager initialized');

    // Initialize configuration
    await withRetry(
      () => config.initialize(),
      { name: 'Configuration initialization', retries: 3 }
    );
    logger.info('Configuration initialized');

    // Register services in order
    serviceManager.register('secretManager', secretManager);
    serviceManager.register('config', config);
    serviceManager.register('taskQueue', taskQueueService);
    serviceManager.register('pubsub', new PubSubManager());

    // Initialize all services
    await serviceManager.initializeAll();

    setupGracefulShutdown();
    return true;
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

function setupGracefulShutdown() {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    try {
      const timeout = setTimeout(() => {
        logger.error('Shutdown timed out, forcing exit');
        process.exit(1);
      }, 30000);

      await serviceManager.shutdownAll();

      if (server) {
        server.close(() => {
          logger.info('Server closed');
          clearTimeout(timeout);
          process.exit(0);
        });
      } else {
        clearTimeout(timeout);
        process.exit(0);
      }
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Start the server
initializeServices().catch((error) => {
  logger.error('Fatal error during initialization:', error);
  process.exit(1);
});