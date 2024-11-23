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

    this.initPromise = (async () => {
      if (!this.projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable not set');
      }

      try {
        this.logger.info('Initializing Secret Manager...');
        
        // Initialize client with more lenient timeouts
        this.client = new SecretManagerServiceClient({
          projectId: this.projectId,
          clientConfig: {
            timeout: 60000, // 60 seconds
            retry: {
              initialDelayMillis: 1000,
              retryDelayMultiplier: 2,
              maxDelayMillis: 30000,
              maxRetries: 5
            }
          }
        });
        
        // Test connection with retries
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await this.client.listSecrets({
              parent: `projects/${this.projectId}`,
              pageSize: 1
            });
            
            this.initialized = true;
            this.logger.info('Secret Manager initialized successfully');
            return;
          } catch (error) {
            lastError = error;
            if (attempt < 3) {
              const delay = Math.pow(2, attempt) * 1000;
              this.logger.warn(`Secret Manager connection attempt ${attempt} failed, retrying in ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        throw lastError;
      } catch (error) {
        this.initialized = false;
        this.initPromise = null;
        this.logger.error('Failed to initialize Secret Manager:', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  async getSecret(secretName) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Check cache first
      if (this.cache.has(secretName)) {
        return this.cache.get(secretName);
      }

      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      
      // Attempt to get secret with retries
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const [version] = await this.client.accessSecretVersion({
            name,
            timeout: 30000 // 30 seconds
          });

          if (!version?.payload?.data) {
            throw new Error(`Secret ${secretName} is empty or invalid`);
          }

          const value = version.payload.data.toString('utf8');
          this.cache.set(secretName, value);
          
          return value;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            const delay = Math.pow(2, attempt) * 1000;
            this.logger.warn(`Failed to get secret ${secretName}, attempt ${attempt}, retrying in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError;
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