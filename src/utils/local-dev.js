const { createLogger } = require('./logger');

/**
 * Mock Secret Manager for local development
 * Allows running the app locally without GCP Secret Manager
 */
class MockSecretManager {
  constructor() {
    this.logger = createLogger('MockSecretManager');
    this.initialized = false;
    
    // Add your local development secrets here
    this.secrets = {
      'PENDING_APPRAISALS_SPREADSHEET_ID': 'mock-spreadsheet-id',
      'WORDPRESS_API_URL': 'https://resources.appraisily.com/wp-json/wp/v2',
      'WORDPRESS_USERNAME': 'local-dev-user',
      'WORDPRESS_PASSWORD': 'local-dev-password',
      'OPENAI_API_KEY': 'sk-mock-openai-key',
      'SENDGRID_API_KEY': 'mock-sendgrid-key',
      'GOOGLE_DOCS_FOLDER_ID': 'mock-folder-id'
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    this.logger.info('Initializing Mock Secret Manager for local development...');
    this.initialized = true;
    this.logger.info('Mock Secret Manager initialized successfully');
  }

  async getSecret(name) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.secrets[name]) {
      this.logger.info(`Loaded mock secret: ${name}`);
      return this.secrets[name];
    } else {
      this.logger.warn(`Unknown mock secret requested: ${name}`);
      return `mock-value-for-${name}`;
    }
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new MockSecretManager(); 