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
      return Promise.resolve();
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  async _initialize() {
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
      const secretMappings = {
        'PENDING_APPRAISALS_SPREADSHEET_ID': 'PENDING_APPRAISALS_SPREADSHEET_ID',
        'WORDPRESS_API_URL': 'WORDPRESS_API_URL',
        'wp_username': 'WP_USERNAME',
        'wp_app_password': 'WP_APP_PASSWORD',
        'SENDGRID_API_KEY': 'SENDGRID_API_KEY',
        'SENDGRID_EMAIL': 'SENDGRID_EMAIL',
        'OPENAI_API_KEY': 'OPENAI_API_KEY',
        'service-account-json': 'SERVICE_ACCOUNT_JSON'
      };

      // Load secrets sequentially
      for (const [secretName, configKey] of Object.entries(secretMappings)) {
        try {
          const value = await secretManager.getSecret(secretName);
          this.secrets[configKey] = value;
          this.logger.info(`Loaded secret: ${secretName}`);
          
          // Small delay between secret loads to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          this.logger.error(`Failed to load secret ${secretName}:`, error);
          throw error;
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