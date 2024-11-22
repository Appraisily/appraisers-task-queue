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
      this.logger.info('Starting configuration initialization...');

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

      this.logger.info(`Loading ${requiredSecrets.length} secrets...`);
      const loadedSecrets = [];
      const failedSecrets = [];

      // Load secrets sequentially to avoid overwhelming Secret Manager
      for (const { name, required } of requiredSecrets) {
        try {
          const value = await secretManager.getSecret(name);
          const configKey = name.replace(/-/g, '_').toUpperCase();
          this[configKey] = value;
          loadedSecrets.push(name);
          this.logger.debug(`Loaded secret: ${name}`);
        } catch (error) {
          if (required) {
            failedSecrets.push({ name, error: error.message });
            this.logger.error(`Failed to load required secret: ${name}`, error);
            throw error;
          }
          this.logger.warn(`Optional secret ${name} not found:`, error.message);
        }
      }

      // Log summary of loaded secrets
      this.logger.info(`Successfully loaded ${loadedSecrets.length} secrets`);
      
      if (failedSecrets.length > 0) {
        throw new Error(
          `Failed to load ${failedSecrets.length} required secrets:\n` +
          failedSecrets.map(f => `- ${f.name}: ${f.error}`).join('\n')
        );
      }

      this.initialized = true;
      this.logger.info('Configuration initialization completed successfully');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Configuration initialization failed:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new Config();