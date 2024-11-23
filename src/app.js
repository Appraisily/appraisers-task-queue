const express = require('express');
const cors = require('cors');
const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('./utils/logger');
const config = require('./config');
const { appraisalService } = require('./services');

const logger = createLogger('App');
const app = express();
let pubsub;
let subscription;
let isInitialized = false;
let initializationError = null;
let initializationPromise = null;

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

async function initializePubSub() {
  try {
    logger.info('Initializing PubSub connection...');
    
    pubsub = new PubSub({ 
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      // Add timeout settings
      clientConfig: {
        timeout: 30000,
        retry: {
          initialDelayMillis: 100,
          retryDelayMultiplier: 1.3,
          maxDelayMillis: 10000,
          maxRetries: 3
        }
      }
    });

    subscription = pubsub.subscription('appraisal-tasks-subscription');

    // Set up message handler
    subscription.on('message', async (message) => {
      if (!isInitialized) {
        logger.warn('Received message before initialization completed');
        message.nack(); // Negative acknowledge to retry later
        return;
      }

      try {
        const data = JSON.parse(message.data.toString());
        logger.info('Processing message:', { messageId: message.id });

        if (!data.id || !data.appraisalValue || !data.description) {
          throw new Error('Invalid message data structure');
        }

        await appraisalService.processAppraisal(
          data.id,
          data.appraisalValue,
          data.description
        );

        message.ack();
        logger.info('Task processed successfully');
      } catch (error) {
        logger.error('Error processing message:', error);
        message.ack(); // Acknowledge to prevent infinite retries
      }
    });

    // Handle subscription errors without crashing
    subscription.on('error', error => {
      logger.error('Subscription error:', error);
      // Don't mark as uninitialized - let the service continue
    });

    logger.info('PubSub initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize PubSub:', error);
    throw error;
  }
}

async function initializeServices() {
  // If initialization is already in progress, return the existing promise
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      logger.info('Starting service initialization...');

      // Step 1: Initialize configuration
      await config.initialize();
      logger.info('Configuration initialized');

      // Step 2: Initialize appraisal service (which handles its dependencies)
      await appraisalService.initialize(config);
      logger.info('Appraisal service initialized');

      // Step 3: Initialize PubSub last
      await initializePubSub();
      logger.info('PubSub connection established');

      isInitialized = true;
      initializationError = null;
      logger.info('All services initialized successfully');
    } catch (error) {
      isInitialized = false;
      initializationError = error;
      logger.error('Service initialization failed:', error);
      throw error;
    } finally {
      // Clear the promise to allow future retry attempts
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

// Start server and initialize services
async function startServer() {
  const PORT = process.env.PORT || 8080;

  // Start HTTP server immediately
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Task Queue service running on port ${PORT}`);
  });

  // Handle server errors
  server.on('error', (error) => {
    logger.error('Server error:', error);
    process.exit(1);
  });

  // Initialize services in the background
  initializeServices().catch(error => {
    logger.error('Background initialization failed:', error);
    // Don't exit - let health checks report the error
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal. Starting graceful shutdown...');
  
  if (subscription) {
    try {
      await subscription.close();
      logger.info('PubSub subscription closed');
    } catch (error) {
      logger.error('Error closing subscription:', error);
    }
  }
  
  process.exit(0);
});

// Start everything
startServer();