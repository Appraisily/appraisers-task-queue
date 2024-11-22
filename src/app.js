const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const config = require('./config');
const { PubSubManager } = require('./services/pubSubManager');

const logger = createLogger('app');
const app = express();

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

// Health check endpoint
app.get('/health', (req, res) => {
  const pubSubManager = req.app.locals.pubSubManager;
  const status = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      pubsub: pubSubManager?.getStatus() ?? 'not_initialized',
      config: config.initialized ? 'initialized' : 'not_initialized'
    }
  };

  const isHealthy = pubSubManager?.isHealthy() && config.initialized;
  const statusCode = isHealthy ? 200 : 503;

  if (!isHealthy) {
    status.status = 'unhealthy';
    status.error = 'One or more services are not initialized';
  }

  res.status(statusCode).json(status);
});

async function initializeServices() {
  try {
    // Initialize configuration
    await config.initialize();
    logger.info('Configuration initialized');

    // Initialize PubSub manager
    const pubSubManager = new PubSubManager();
    await pubSubManager.initialize();
    logger.info('PubSub manager initialized');

    return pubSubManager;
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

async function startServer() {
  try {
    const PORT = process.env.PORT || 8080;
    
    // Start listening for requests
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Task Queue service running on port ${PORT}`);
    });

    // Initialize services after server starts listening
    const pubSubManager = await initializeServices();
    app.locals.pubSubManager = pubSubManager;

    // Graceful shutdown handler
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal. Starting graceful shutdown...');
      
      try {
        await pubSubManager?.shutdown();
        server.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Start the server
startServer();