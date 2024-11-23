const sendGridMail = require('@sendgrid/mail');
const { createLogger } = require('../utils/logger');

class EmailService {
  constructor() {
    this.logger = createLogger('EmailService');
    this.initialized = false;
    this.config = null;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.config = config;
      sendGridMail.setApiKey(config.SENDGRID_API_KEY);
      this.initialized = true;
      this.logger.info('Email service initialized');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize email service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async sendAppraisalCompletedEmail(customerEmail, customerName, appraisalData) {
    if (!this.initialized) {
      throw new Error('Email service not initialized');
    }

    try {
      const currentYear = new Date().getFullYear();

      const emailContent = {
        to: customerEmail,
        from: this.config.SENDGRID_EMAIL,
        templateId: this.config.SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED,
        dynamic_template_data: {
          customer_name: customerName,
          appraisal_value: appraisalData.value,
          description: appraisalData.description,
          pdf_link: appraisalData.pdfLink,
          dashboard_link: `https://www.appraisily.com/dashboard/?email=${encodeURIComponent(customerEmail)}`,
          current_year: currentYear,
        },
      };

      await sendGridMail.send(emailContent);
      this.logger.info(`Appraisal completed email sent to ${customerEmail}`);
    } catch (error) {
      this.logger.error('Error sending appraisal completed email:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();