const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secretManager');

class Config {
  constructor() {
    this.logger = createLogger('Config');
    this.initialized = false;
    this.GOOGLE_SHEET_NAME = 'Pending';

    // Required environment variables
    this.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing configuration...');

      // Validate required environment variables
      if (!this.GOOGLE_CLOUD_PROJECT_ID) {
        throw new Error('Missing required environment variable: GOOGLE_CLOUD_PROJECT_ID');
      }

      // Define required secrets with descriptions
      const requiredSecrets = [
        { name: 'PENDING_APPRAISALS_SPREADSHEET_ID', required: true },
        { name: 'WORDPRESS_API_URL', required: true },
        { name: 'wp_username', required: true },
        { name: 'wp_app_password', required: true },
        { name: 'SENDGRID_API_KEY', required: true },
        { name: 'SENDGRID_EMAIL', required: true },
        { name: 'SENDGRID_SECRET_NAME', required: false },
        { name: 'SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED', required: false },
        { name: 'OPENAI_API_KEY', required: true },
        { name: 'service-account-json', required: true }
      ];

      // Load secrets sequentially to avoid overwhelming Secret Manager
      for (const { name, required } of requiredSecrets) {
        try {
          const value = await secretManager.getSecret(name);
          const configKey = name.replace(/-/g, '_').toUpperCase();
          this[configKey] = value;
          this.logger.info(`Loaded secret: ${name}`);
        } catch (error) {
          if (required) {
            throw error;
          }
          this.logger.warn(`Optional secret ${name} not found:`, error.message);
        }
      }

      // Validate all required secrets are loaded
      const missingSecrets = requiredSecrets
        .filter(({ name, required }) => required && !this[name.replace(/-/g, '_').toUpperCase()]);

      if (missingSecrets.length > 0) {
        throw new Error(`Missing required secrets: ${missingSecrets.map(s => s.name).join(', ')}`);
      }

      this.initialized = true;
      this.logger.info('Configuration initialized successfully');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize configuration:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new Config();