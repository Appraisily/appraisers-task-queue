const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const config = require('./config');
const { PubSubManager } = require('./services/pubSubManager');

const logger = createLogger('app');
const app = express();
let pubSubManager;

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

app.get('/health', (req, res) => {
  const isHealthy = pubSubManager?.isHealthy() ?? false;
  const status = isHealthy ? 200 : 503;
  
  res.status(status).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pubsub: pubSubManager?.getStatus() ?? 'not_initialized'
  });
});

async function startServer() {
  try {
    // Initialize configuration first
    await config.initialize();
    
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Task Queue service running on port ${PORT}`);
    });

    // Initialize PubSub manager after config is ready
    pubSubManager = new PubSubManager();
    await pubSubManager.initialize();

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal. Starting graceful shutdown...');
  await pubSubManager?.shutdown();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

startServer();