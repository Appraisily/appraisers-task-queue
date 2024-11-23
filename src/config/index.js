const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secretManager');

class Config {
  constructor() {
    this.logger = createLogger('Config');
    this.initialized = false;
    this.initPromise = null;
    this.GOOGLE_SHEET_NAME = 'Pending';
    this.secrets = {};

    // Required environment variables
    this.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
  }

  async initialize() {
    // Return existing promise if initialization is in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    // Return immediately if already initialized
    if (this.initialized) {
      return this;
    }

    try {
      this.logger.info('Starting configuration initialization...');

      // Validate required environment variables
      if (!this.GOOGLE_CLOUD_PROJECT_ID) {
        throw new Error('Missing required environment variable: GOOGLE_CLOUD_PROJECT_ID');
      }

      // Initialize secret manager first
      await secretManager.initialize();
      this.logger.info('Secret Manager initialized');

      // Define required secrets with their config key mappings
      const requiredSecrets = [
        { name: 'PENDING_APPRAISALS_SPREADSHEET_ID', key: 'PENDING_APPRAISALS_SPREADSHEET_ID', required: true },
        { name: 'WORDPRESS_API_URL', key: 'WORDPRESS_API_URL', required: true },
        { name: 'wp_username', key: 'wp_username', required: true },
        { name: 'wp_app_password', key: 'wp_app_password', required: true },
        { name: 'SENDGRID_API_KEY', key: 'SENDGRID_API_KEY', required: true },
        { name: 'SENDGRID_EMAIL', key: 'SENDGRID_EMAIL', required: true },
        { name: 'OPENAI_API_KEY', key: 'OPENAI_API_KEY', required: true },
        { name: 'service-account-json', key: 'SERVICE_ACCOUNT_JSON', required: true }
      ];

      // Load all secrets sequentially to avoid rate limiting
      for (const { name, key, required } of requiredSecrets) {
        try {
          const value = await secretManager.getSecret(name);
          this.secrets[key] = value;
          this.logger.info(`Loaded secret: ${name}`);
        } catch (error) {
          if (required) {
            throw new Error(`Failed to load required secret ${name}: ${error.message}`);
          }
          this.logger.warn(`Optional secret ${name} not loaded: ${error.message}`);
        }
      }

      // Copy secrets to main config
      Object.assign(this, this.secrets);

      this.initialized = true;
      this.logger.info(`Successfully loaded ${Object.keys(this.secrets).length} secrets`);
      
      return this;
    } catch (error) {
      this.initialized = false;
      this.initPromise = null;
      this.logger.error('Configuration initialization failed:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  getSecret(name) {
    if (!this.initialized) {
      throw new Error('Configuration not initialized');
    }
    
    const value = this.secrets[name];
    if (!value) {
      throw new Error(`Secret ${name} not found`);
    }
    return value;
  }
}

module.exports = new Config();