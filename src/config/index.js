const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('../utils/logger');

class Config {
  constructor() {
    this.logger = createLogger('Config');
    this.secretClient = new SecretManagerServiceClient();
    this.initialized = false;

    // Required environment variables
    this.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;

    // Default values that can be overridden by secrets
    this.GOOGLE_SHEET_NAME = 'Pending';
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

      // Load all secrets with increased timeout
      const secrets = await Promise.all([
        this.getSecret('PENDING_APPRAISALS_SPREADSHEET_ID'),
        this.getSecret('WORDPRESS_API_URL'),
        this.getSecret('wp_username'),
        this.getSecret('wp_app_password'),
        this.getSecret('SENDGRID_API_KEY'),
        this.getSecret('SENDGRID_EMAIL'),
        this.getSecret('SENDGRID_SECRET_NAME'),
        this.getSecret('SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED'),
        this.getSecret('OPENAI_API_KEY'),
        this.getSecret('service-account-json')
      ]);

      // Set configuration from secrets
      [
        this.PENDING_APPRAISALS_SPREADSHEET_ID,
        this.WORDPRESS_API_URL,
        this.WORDPRESS_USERNAME,
        this.WORDPRESS_APP_PASSWORD,
        this.SENDGRID_API_KEY,
        this.SENDGRID_EMAIL,
        this.SENDGRID_SECRET_NAME,
        this.SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED,
        this.OPENAI_API_KEY,
        this.SERVICE_ACCOUNT_JSON
      ] = secrets;

      this.initialized = true;
      this.logger.info('Configuration initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize configuration:', error);
      throw error;
    }
  }

  async getSecret(secretName, timeoutSeconds = 60) {
    try {
      const name = `projects/${this.GOOGLE_CLOUD_PROJECT_ID}/secrets/${secretName}/versions/latest`;
      
      const [version] = await this.secretClient.accessSecretVersion({
        name,
        timeout: timeoutSeconds * 1000 // Convert to milliseconds
      });

      return version.payload.data.toString('utf8');
    } catch (error) {
      this.logger.error(`Error getting secret ${secretName}:`, error);
      throw error;
    }
  }
}

module.exports = new Config();