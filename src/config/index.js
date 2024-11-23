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
      // Validate required environment variables
      if (!this.GOOGLE_CLOUD_PROJECT_ID) {
        throw new Error('Missing required environment variable: GOOGLE_CLOUD_PROJECT_ID');
      }

      // Initialize secret manager first
      await secretManager.initialize();

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

      // Load all secrets in parallel
      const results = await Promise.all(
        requiredSecrets.map(async name => {
          try {
            const value = await secretManager.getSecret(name);
            return { name, value };
          } catch (error) {
            this.logger.error(`Failed to load secret ${name}:`, error);
            throw error;
          }
        })
      );

      // Store secrets
      results.forEach(({ name, value }) => {
        const key = name.replace(/-/g, '_').toUpperCase();
        this.secrets[key] = value;
      });

      // Copy secrets to main config
      Object.assign(this, this.secrets);

      this.initialized = true;
      this.logger.info(`Successfully loaded ${results.length} secrets`);
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