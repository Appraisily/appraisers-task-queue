const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./logger');

class SecretManager {
  constructor() {
    this.logger = createLogger('SecretManager');
    this.client = null;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.cache = new Map();
    this.initialized = false;
    this.initPromise = null;
  }

  async initialize() {
    // Return existing promise if initialization is in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    // Return immediately if already initialized
    if (this.initialized) {
      return Promise.resolve();
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  async _initialize() {
    if (!this.projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable not set');
    }

    try {
      this.logger.info('Initializing Secret Manager...');
      
      // Initialize client with timeout settings
      this.client = new SecretManagerServiceClient({
        projectId: this.projectId,
        clientConfig: {
          timeout: 30000,
          retry: {
            initialDelayMillis: 100,
            retryDelayMultiplier: 1.3,
            maxDelayMillis: 10000,
            maxRetries: 3
          }
        }
      });
      
      // Test connection
      await this.client.listSecrets({
        parent: `projects/${this.projectId}`,
        pageSize: 1
      });
      
      this.initialized = true;
      this.logger.info('Secret Manager initialized successfully');
    } catch (error) {
      this.initialized = false;
      this.initPromise = null;
      this.logger.error('Failed to initialize Secret Manager:', error);
      throw error;
    }
  }

  async getSecret(secretName) {
    // Ensure initialization before getting secrets
    await this.initialize();

    try {
      // Check cache first
      if (this.cache.has(secretName)) {
        return this.cache.get(secretName);
      }

      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      
      const [version] = await this.client.accessSecretVersion({
        name,
        timeout: 10000
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