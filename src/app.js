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
let isInitializing = false;
let isInitialized = false;

app.use(cors());
app.use(express.json());

// Health check endpoint - keep it lightweight
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ready: isInitialized
  });
});

async function processMessage(message) {
  try {
    // Ensure services are initialized before processing
    if (!isInitialized) {
      await initializeServices();
    }

    const data = JSON.parse(message.data.toString());
    
    logger.info('Processing message:', {
      messageId: message.id,
      data: data
    });

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
    message.ack();
  }
}

async function initializeServices() {
  if (isInitialized || isInitializing) {
    return;
  }

  isInitializing = true;

  try {
    logger.info('Starting service initialization...');

    // Initialize PubSub first - it's lightweight
    logger.info('Initializing PubSub...');
    pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });
    subscription = pubsub.subscription('appraisal-tasks-subscription');

    subscription.on('message', processMessage);
    subscription.on('error', error => {
      logger.error('Subscription error:', error);
    });

    logger.info('PubSub initialized successfully');

    // Initialize config and services only when needed
    await config.initialize();
    await appraisalService.initialize(config);

    isInitialized = true;
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Service initialization failed:', error);
    throw error;
  } finally {
    isInitializing = false;
  }
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Task Queue service running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal. Starting graceful shutdown...');
  if (subscription) {
    subscription.close();
  }
  process.exit(0);
});