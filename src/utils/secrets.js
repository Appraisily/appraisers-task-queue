const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./logger');

// Fallback values for critical secrets - only used if Secret Manager fails
const FALLBACK_SECRETS = {
  'PENDING_APPRAISALS_SPREADSHEET_ID': process.env.PENDING_APPRAISALS_SPREADSHEET_ID || '1PuGYaHJYo5yQPg-QWdFv-AfnPb4-LG8LuRSE7cDV2zs'
};

class SecretManager {
  constructor() {
    this.logger = createLogger('SecretManager');
    this.client = null;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'civil-forge-403609';
    this.initialized = false;
    this.secretCache = new Map();
    // Default retry configuration
    this.maxRetries = 3;
    this.timeoutMs = 30000; // 30 seconds
  }

  async initialize() {
    if (this.initialized) return;

    try {
      this.logger.info('Initializing Secret Manager...');
      
      if (!this.projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT_ID environment variable not set');
      }

      this.client = new SecretManagerServiceClient({
        fallback: true, // Allow fallback to HTTP/1
        timeout: this.timeoutMs
      });
      this.initialized = true;
      this.logger.info('Secret Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Secret Manager:', error);
      throw error;
    }
  }

  async getSecret(name, allowFallback = true) {
    // Check cache first
    if (this.secretCache.has(name)) {
      return this.secretCache.get(name);
    }

    if (!this.initialized) {
      await this.initialize();
    }
    
    // Track retries
    let retryCount = 0;
    let lastError = null;

    while (retryCount < this.maxRetries) {
      try {
        const [version] = await this.client.accessSecretVersion({
          name: `projects/${this.projectId}/secrets/${name}/versions/latest`
        });

        if (!version?.payload?.data) {
          throw new Error(`Secret ${name} is empty or invalid`);
        }

        // Clean up secret value by removing any whitespace or newlines
        const value = version.payload.data.toString('utf8').trim();
        this.logger.info(`Loaded secret: ${name}`);
        
        // Cache the value
        this.secretCache.set(name, value);
        return value;
      } catch (error) {
        lastError = error;
        retryCount++;
        
        const isTimeout = 
          error.code === 4 || // DEADLINE_EXCEEDED
          error.message?.includes('Deadline exceeded') ||
          error.message?.includes('timeout');
        
        if (isTimeout && retryCount < this.maxRetries) {
          const delay = Math.min(500 * Math.pow(2, retryCount), 10000); // Exponential backoff with max 10s
          this.logger.warn(`Timeout getting secret ${name}, retrying (${retryCount}/${this.maxRetries}) in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        this.logger.error(`Error getting secret ${name} (attempt ${retryCount}/${this.maxRetries}):`, error);
        
        // Only try once more on the last attempt if we have not reached max retries
        if (retryCount < this.maxRetries) {
          const delay = Math.min(500 * Math.pow(2, retryCount), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    
    // All retries failed, check if fallback is allowed and exists
    if (allowFallback && FALLBACK_SECRETS[name]) {
      this.logger.warn(`Using fallback value for secret ${name} after ${this.maxRetries} failed attempts`);
      const fallbackValue = FALLBACK_SECRETS[name];
      this.secretCache.set(name, fallbackValue);
      return fallbackValue;
    }
    
    // No fallback, propagate the error
    throw lastError || new Error(`Failed to get secret ${name} after ${this.maxRetries} attempts`);
  }

  isInitialized() {
    return this.initialized;
  }
  
  clearCache() {
    this.secretCache.clear();
  }
}

module.exports = new SecretManager();