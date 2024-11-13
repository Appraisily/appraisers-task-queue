const { getSecret } = require('../utils/secretManager');

const config = {};

async function initializeConfig() {
  try {
    config.GOOGLE_CLOUD_PROJECT_ID = (await getSecret('GOOGLE_CLOUD_PROJECT_ID')).trim();
    config.BACKEND_API_URL = (await getSecret('BACKEND_API_URL')).trim();
    config.API_KEY = (await getSecret('API_KEY')).trim();

    console.log('Configuration initialized successfully');
  } catch (error) {
    console.error('Error initializing configuration:', error);
    throw error;
  }
}

module.exports = { config, initializeConfig };