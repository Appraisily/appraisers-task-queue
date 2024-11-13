const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const jwt = require('jsonwebtoken');

const config = {};

async function loadJwtSecret() {
  try {
    const secretClient = new SecretManagerServiceClient();
    const secretName = `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/secrets/jwt-secret/versions/latest`;
    
    console.log('Loading JWT secret from Secret Manager...');
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    config.JWT_SECRET = version.payload.data.toString('utf8');
    
    if (!config.JWT_SECRET) {
      throw new Error('JWT secret is empty');
    }
    console.log('JWT secret loaded successfully');
    
    // Verify the secret is valid for JWT signing
    const testToken = jwt.sign({ test: true }, config.JWT_SECRET, { expiresIn: '10s' });
    jwt.verify(testToken, config.JWT_SECRET);
    console.log('JWT secret verified and working correctly');
  } catch (error) {
    console.error('Failed to load JWT secret:', error);
    throw new Error('Could not initialize JWT authentication');
  }
}

async function initializeConfig() {
  try {
    // Essential environment variables
    config.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
    config.BACKEND_API_URL = 'https://appraisers-backend-856401495068.us-central1.run.app';

    if (!config.GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error('Required environment variables are not set');
    }

    console.log('Environment variables loaded:', {
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      backendUrl: config.BACKEND_API_URL
    });

    // Load JWT secret first
    await loadJwtSecret();

    console.log('Configuration initialized successfully');
  } catch (error) {
    console.error('Error initializing configuration:', error);
    throw error;
  }
}

module.exports = { config, initializeConfig };