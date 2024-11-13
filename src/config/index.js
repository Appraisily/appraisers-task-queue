const config = {};

async function initializeConfig() {
  try {
    // Essential environment variables
    config.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
    config.BACKEND_API_URL = process.env.BACKEND_API_URL;

    if (!config.GOOGLE_CLOUD_PROJECT_ID || !config.BACKEND_API_URL) {
      throw new Error('Required environment variables are not set');
    }

    console.log('Configuration initialized successfully');
  } catch (error) {
    console.error('Error initializing configuration:', error);
    throw error;
  }
}

module.exports = { config, initializeConfig };