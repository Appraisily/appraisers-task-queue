const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./logger');

class SecretManager {
  constructor() {
    this.logger = createLogger('SecretManager');
    this.client = null;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      this.logger.info('Initializing Secret Manager...');
      
      if (!this.projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable not set');
      }

      this.client = new SecretManagerServiceClient();
      this.initialized = true;
      this.logger.info('Secret Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Secret Manager:', error);
      throw error;
    }
  }

  async getSecret(name) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${name}/versions/latest`
      });

      if (!version.payload.data) {
        throw new Error(`Secret ${name} is empty or invalid`);
      }

      const value = version.payload.data.toString('utf8');
      this.logger.info(`Loaded secret: ${name}`);
      return value;
    } catch (error) {
      this.logger.error(`Error getting secret ${name}:`, error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new SecretManager();