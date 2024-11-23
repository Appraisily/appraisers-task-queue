require('dotenv').config();

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

app.use(cors());
app.use(express.json());

// Health check endpoint - keep it lightweight
app.get('/health', (req, res) => {
  res.status(200).json({
    status: isInitialized ? 'healthy' : 'initializing',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ready: isInitialized
  });
});

async function processMessage(message) {
  try {
    const data = JSON.parse(message.data.toString());
    logger.info({ messageId: message.id }, 'Processing message');

    if (!data.id || !data.appraisalValue || !data.description) {
      throw new Error('Invalid message data structure');
    }

    await appraisalService.processAppraisal(
      data.id,
      data.appraisalValue,
      data.description
    );

    message.ack();
    logger.info({ messageId: message.id }, 'Task processed successfully');
  } catch (error) {
    logger.error({ error: error.message, messageId: message.id }, 'Error processing message');
    message.ack(); // Acknowledge to prevent infinite retries
  }
}

async function initializeServices() {
  try {
    logger.info('Starting service initialization...');

    // Initialize config first
    await config.initialize();
    logger.info('Configuration initialized');

    // Initialize PubSub
    pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT_ID });
    subscription = pubsub.subscription('appraisal-tasks-subscription');

    // Initialize appraisal service and its dependencies
    await appraisalService.initialize(config);
    logger.info('Appraisal service initialized');

    // Set up message handler only after all services are ready
    subscription.on('message', processMessage);
    subscription.on('error', error => {
      logger.error({ error: error.message }, 'Subscription error');
    });

    isInitialized = true;
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error({ error: error.message }, 'Service initialization failed');
    throw error;
  }
}

const PORT = process.env.PORT || 8080;

// Start server and initialize services
async function startServer() {
  try {
    // Start server first to handle health checks
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Task Queue service running on port ${PORT}`);
    });

    // Initialize all services
    await initializeServices();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal. Starting graceful shutdown...');
  if (subscription) {
    subscription.close();
  }
  process.exit(0);
});

// Start everything
startServer();