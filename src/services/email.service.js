const sendGridMail = require('@sendgrid/mail');
const { getSecret } = require('../utils/secretManager');
const { createLogger } = require('../utils/logger');

class EmailService {
  constructor() {
    this.logger = createLogger('EmailService');
  }

  async initialize() {
    try {
      // Use exact secret name from README
      const apiKey = await getSecret('SENDGRID_API_KEY');
      sendGridMail.setApiKey(apiKey);
      this.logger.info('Email service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize email service:', error);
      throw error;
    }
  }

  // Rest of the code remains the same...
}