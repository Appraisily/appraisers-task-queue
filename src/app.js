require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('./utils/logger');
const config = require('./config');
const { appraisalService } = require('./services');

const logger = createLogger('app');
const app = express();
let pubsub;
let subscription;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  const isHealthy = subscription !== null;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      pubsub: isHealthy ? 'connected' : 'disconnected',
      appraisal: appraisalService.isInitialized() ? 'initialized' : 'not_initialized'
    }
  });
});

async function processMessage(message) {
  try {
    const data = JSON.parse(message.data.toString());
    
    logger.info('Processing message:', {
      messageId: message.id,
      data: data
    });

    // Validate message structure
    if (!data.id || !data.appraisalValue || !data.description) {
      throw new Error('Invalid message data structure');
    }

    // Start the appraisal process
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
}

async function initialize() {
  try {
    // Initialize config first
    await config.initialize();

    // Initialize appraisal service
    await appraisalService.initialize(config);

    // Initialize PubSub
    pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT_ID });
    subscription = pubsub.subscription('appraisal-tasks-subscription');

    // Set up message handler
    subscription.on('message', processMessage);
    subscription.on('error', error => {
      logger.error('Subscription error:', error);
    });

    logger.info('Service initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize service:', error);
    throw error;
  }
}

async function startServer() {
  const PORT = process.env.PORT || 8080;
  
  try {
    // Start server first
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Task Queue service running on port ${PORT}`);
    });

    // Initialize services
    await initialize();

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal. Starting graceful shutdown...');
      if (subscription) {
        subscription.close();
      }
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();