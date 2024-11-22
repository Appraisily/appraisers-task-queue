const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./logger');

class SecretManager {
  constructor() {
    this.logger = createLogger('SecretManager');
    this.client = new SecretManagerServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.cache = new Map();
    this.retryCount = 5;
    this.retryDelay = 1000;
    this.timeout = 30000;
    this.initialized = false;
  }

  async initialize() {
    if (!this.projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable not set');
    }

    try {
      this.logger.info('Initializing Secret Manager...');
      
      // Test connection by listing secrets
      await this.client.listSecrets({
        parent: `projects/${this.projectId}`
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
        this.logger.debug(`Using cached value for secret: ${secretName}`);
        return this.cache.get(secretName);
      }

      this.logger.debug(`Fetching secret: ${secretName}`);
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      let lastError;

      for (let attempt = 1; attempt <= this.retryCount; attempt++) {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), this.timeout);
          });

          const fetchPromise = this.client.accessSecretVersion({ name });
          const [version] = await Promise.race([fetchPromise, timeoutPromise]);

          if (!version?.payload?.data) {
            throw new Error(`Secret ${secretName} is empty or invalid`);
          }

          const value = version.payload.data.toString('utf8');
          this.cache.set(secretName, value);
          
          if (attempt > 1) {
            this.logger.debug(`Retrieved secret ${secretName} on attempt ${attempt}`);
          }
          
          return value;
        } catch (error) {
          lastError = error;
          
          if (attempt < this.retryCount) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            this.logger.warn(
              `Failed to get secret ${secretName} (attempt ${attempt}/${this.retryCount}). ` +
              `Retrying in ${delay/1000}s:`, error.message
            );
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError;
    } catch (error) {
      this.logger.error(`Failed to get secret ${secretName} after ${this.retryCount} attempts:`, error);
      throw new Error(`Could not get secret ${secretName}: ${error.message}`);
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