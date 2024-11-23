const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secretManager');

class Config {
  constructor() {
    this.logger = createLogger('Config');
    this.initialized = false;
    this.GOOGLE_SHEET_NAME = 'Pending';
    this.secrets = {};

    // Required environment variables
    this.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
  }

  async initialize() {
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

      // Load secrets sequentially to avoid rate limiting
      for (const [secretName, configKey] of Object.entries(secretMappings)) {
        try {
          const value = await secretManager.getSecret(secretName);
          this.secrets[configKey] = value;
          this.logger.info(`Loaded secret: ${secretName}`);
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
      this.logger.error('Configuration initialization failed:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  getSecret(name) {
    const value = this.secrets[name];
    if (!value) {
      throw new Error(`Secret ${name} not found`);
    }
    return value;
  }
}

module.exports = new Config();