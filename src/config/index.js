const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const jwt = require('jsonwebtoken');
const { createLogger } = require('../utils/logger');

const config = {};
const logger = createLogger('config');

async function loadServiceAccountKey() {
  try {
    const secretClient = new SecretManagerServiceClient();
    const secretName = `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/secrets/pubsub-service-account/versions/latest`;
    
    logger.info('Loading PubSub service account from Secret Manager...');
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    const credentials = version.payload.data.toString('utf8');
    
    // Save credentials to a temporary file
    const fs = require('fs');
    const path = require('path');
    const tempPath = path.join(process.cwd(), 'temp-credentials.json');
    fs.writeFileSync(tempPath, credentials);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    
    logger.info('PubSub service account loaded successfully');
  } catch (error) {
    logger.error('Failed to load PubSub service account:', {
      error: error.message,
      code: error.code,
      details: error.details || 'No additional details'
    });
    throw new Error('Could not initialize PubSub authentication');
  }
}

async function loadJwtSecret() {
  try {
    const secretClient = new SecretManagerServiceClient();
    const secretName = `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/secrets/jwt-secret/versions/latest`;
    
    logger.info('Loading JWT secret from Secret Manager...');
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    config.JWT_SECRET = version.payload.data.toString('utf8');
    
    if (!config.JWT_SECRET) {
      throw new Error('JWT secret is empty');
    }
    logger.info('JWT secret loaded successfully');
    
    // Verify the secret is valid for JWT signing
    const testToken = jwt.sign({ test: true }, config.JWT_SECRET, { expiresIn: '10s' });
    jwt.verify(testToken, config.JWT_SECRET);
    logger.info('JWT secret verified and working correctly');
  } catch (error) {
    logger.error('Failed to load JWT secret:', {
      error: error.message,
      code: error.code,
      details: error.details || 'No additional details'
    });
    throw new Error('Could not initialize JWT authentication');
  }
}

async function initializeConfig() {
  try {
    // Essential environment variables
    config.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
    config.BACKEND_API_URL = 'https://appraisers-backend-856401495068.us-central1.run.app';

    if (!config.GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error('Required environment variable GOOGLE_CLOUD_PROJECT_ID is not set');
    }

    logger.info('Environment variables loaded:', {
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      backendUrl: config.BACKEND_API_URL
    });

    // Load service account first
    await loadServiceAccountKey();
    await loadJwtSecret();
    
    logger.info('Configuration initialized successfully');
  } catch (error) {
    logger.error('Error initializing configuration:', {
      error: error.message,
      stack: error.stack,
      details: error.details || 'No additional details'
    });
    throw error;
  }
}

module.exports = { config, initializeConfig };