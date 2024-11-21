const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const jwt = require('jsonwebtoken');
const { createLogger } = require('../utils/logger');

const logger = createLogger('config');
const config = {};

async function loadServiceAccountKey() {
  try {
    const secretClient = new SecretManagerServiceClient();
    const secretName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/secrets/pubsub-credentials/versions/latest`;
    
    logger.info('Loading PubSub credentials...');
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    const credentials = JSON.parse(version.payload.data.toString('utf8'));
    
    // Store credentials in config
    config.PUBSUB_CREDENTIALS = credentials;
    logger.info('PubSub credentials loaded successfully');
  } catch (error) {
    logger.error('Failed to load PubSub credentials:', {
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

async function loadJwtSecret() {
  try {
    const secretClient = new SecretManagerServiceClient();
    const secretName = `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/secrets/jwt-secret/versions/latest`;
    
    logger.info('Loading JWT secret...');
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    config.JWT_SECRET = version.payload.data.toString('utf8');
    
    if (!config.JWT_SECRET) {
      throw new Error('JWT secret is empty');
    }
    logger.info('JWT secret loaded successfully');
    
    // Verify the secret
    const testToken = jwt.sign({ test: true }, config.JWT_SECRET, { expiresIn: '10s' });
    jwt.verify(testToken, config.JWT_SECRET);
    logger.info('JWT secret verified successfully');
  } catch (error) {
    logger.error('Failed to load JWT secret:', {
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

async function initializeConfig() {
  try {
    // Load environment variables
    config.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
    config.BACKEND_API_URL = process.env.BACKEND_API_URL || 'https://appraisers-backend-856401495068.us-central1.run.app';

    if (!config.GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable is not set');
    }

    logger.info('Environment variables loaded:', {
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      backendUrl: config.BACKEND_API_URL
    });

    // Load secrets
    await loadServiceAccountKey();
    await loadJwtSecret();

    logger.info('Configuration initialized successfully');
    return config;
  } catch (error) {
    logger.error('Error initializing configuration:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = { config, initializeConfig };