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
      this.logger.info('Initializing Secret Manager...');
      await secretManager.initialize();
      this.logger.info('Secret Manager initialized successfully');

      // Define required secrets
      const requiredSecrets = [
        'PENDING_APPRAISALS_SPREADSHEET_ID',
        'WORDPRESS_API_URL',
        'wp_username',
        'wp_app_password',
        'SENDGRID_API_KEY',
        'SENDGRID_EMAIL',
        'OPENAI_API_KEY',
        'service-account-json'
      ];

      // Load secrets sequentially to avoid rate limiting
      this.logger.info('Loading secrets...');
      for (const name of requiredSecrets) {
        try {
          const value = await secretManager.getSecret(name);
          const key = name.replace(/-/g, '_').toUpperCase();
          this.secrets[key] = value;
          this.logger.info(`Loaded secret: ${name}`);
        } catch (error) {
          this.logger.error(`Failed to load secret ${name}:`, error);
          throw error;
        }
      }

      // Copy secrets to main config
      Object.assign(this, this.secrets);

      this.initialized = true;
      this.logger.info('Configuration initialization completed successfully');
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
    const value = this.secrets[name.replace(/-/g, '_').toUpperCase()];
    if (!value) {
      throw new Error(`Secret ${name} not found`);
    }
    return value;
  }
}

module.exports = new Config();