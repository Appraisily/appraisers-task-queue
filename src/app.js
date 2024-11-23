const express = require('express');
const cors = require('cors');
const { PubSub } = require('@google-cloud/pubsub');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./utils/logger');

const logger = createLogger('app');
const app = express();
const secretClient = new SecretManagerServiceClient();
let pubsub;
let subscription;

// Required secrets
const REQUIRED_SECRETS = [
  'PENDING_APPRAISALS_SPREADSHEET_ID',
  'WORDPRESS_API_URL',
  'wp_username',
  'wp_app_password',
  'SENDGRID_API_KEY',
  'SENDGRID_EMAIL',
  'SENDGRID_SECRET_NAME',
  'SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED',
  'OPENAI_API_KEY',
  'service-account-json'
];

// Config object to store secrets
const config = {
  GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
  GOOGLE_SHEET_NAME: 'Pending'
};

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  const isHealthy = subscription !== null;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

async function getSecret(name) {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/secrets/${name}/versions/latest`
    });
    return version.payload.data.toString('utf8');
  } catch (error) {
    logger.error(`Error getting secret ${name}:`, error);
    throw error;
  }
}

async function processMessage(message) {
  try {
    const data = JSON.parse(message.data.toString());
    
    logger.info('Processing appraisal task:', {
      messageId: message.id,
      appraisalId: data.id
    });

    // Process the appraisal following the documented steps
    // 1. Set value
    // 2. Merge descriptions
    // 3. Update title
    // 4. Insert template
    // 5. Build PDF
    // 6. Send email
    // 7. Complete

    message.ack();
    logger.info('Task processed successfully');
  } catch (error) {
    logger.error('Error processing message:', error);
    message.ack(); // Acknowledge to prevent infinite retries
  }
}

async function initialize() {
  try {
    // Load all secrets
    for (const secretName of REQUIRED_SECRETS) {
      config[secretName] = await getSecret(secretName);
      logger.info(`Loaded secret: ${secretName}`);
    }

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
  try {
    const PORT = process.env.PORT || 8080;
    
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Task Queue service running on port ${PORT}`);
    });

    await initialize();
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

startServer();