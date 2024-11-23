const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./logger');

class SecretManager {
  constructor() {
    this.logger = createLogger('SecretManager');
    this.client = null;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.cache = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (!this.projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable not set');
    }

    try {
      this.logger.info('Initializing Secret Manager...');
      this.client = new SecretManagerServiceClient({
        projectId: this.projectId,
        // Add timeout settings
        clientConfig: {
          timeout: 30000, // 30 seconds
          retry: {
            initialDelayMillis: 100,
            retryDelayMultiplier: 1.3,
            maxDelayMillis: 10000,
            maxRetries: 3
          }
        }
      });
      
      // Test connection with a simple list operation
      await this.client.listSecrets({
        parent: `projects/${this.projectId}`,
        pageSize: 1
      });
      
      this.initialized = true;
      this.logger.info('Secret Manager initialized successfully');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize Secret Manager:', error);
      throw error;
    }
  }

  async getSecret(secretName) {
    if (!this.initialized) {
      throw new Error('Secret Manager not initialized');
    }

    try {
      // Check cache first
      if (this.cache.has(secretName)) {
        return this.cache.get(secretName);
      }

      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      
      const [version] = await this.client.accessSecretVersion({
        name,
        timeout: 10000 // 10 second timeout per request
      });

      if (!version?.payload?.data) {
        throw new Error(`Secret ${secretName} is empty or invalid`);
      }

      const value = version.payload.data.toString('utf8');
      this.cache.set(secretName, value);
      
      return value;
    } catch (error) {
      this.logger.error(`Error getting secret ${secretName}:`, error);
      throw error;
    }
  }

  clearCache() {
    this.cache.clear();
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new SecretManager();