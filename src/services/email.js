const sendGridMail = require('@sendgrid/mail');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class EmailService {
  constructor() {
    this.logger = createLogger('Email');
    this.senderEmail = null;
    this.templateId = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      const apiKey = await secretManager.getSecret('SENDGRID_API_KEY');
      this.senderEmail = await secretManager.getSecret('SENDGRID_EMAIL');
      this.templateId = await secretManager.getSecret('SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED');
      
      if (!apiKey || !this.senderEmail || !this.templateId) {
        throw new Error('Missing required SendGrid configuration');
      }

      sendGridMail.setApiKey(apiKey);
      this.initialized = true;
      this.logger.info('Email service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize email service:', error);
      throw error;
    }
  }

  async sendAppraisalCompletedEmail(customerEmail, customerName, appraisalData) {
    if (!this.initialized) {
      throw new Error('Email service not initialized');
    }

    if (!customerEmail || !appraisalData?.pdfLink || !appraisalData?.appraisalUrl) {
      throw new Error('Missing required email data');
    }

    this.logger.info(`Preparing to send completion email to ${customerEmail}`);

    const msg = {
      to: customerEmail,
      from: this.senderEmail,
      templateId: this.templateId,
      dynamicTemplateData: {
        customer_name: customerName || 'Valued Customer',
        pdf_link: appraisalData.pdfLink,
        wp_link: appraisalData.appraisalUrl,
        current_year: new Date().getFullYear()
      }
    };

    try {
      const [response] = await sendGridMail.send(msg);
      this.logger.info(`Successfully sent completion email to ${customerEmail}`);
      
      // Return email delivery details
      return {
        timestamp: new Date().toISOString(),
        messageId: response?.headers['x-message-id'],
        recipient: customerEmail,
        status: 'Sent'
      };
    } catch (error) {
      this.logger.error(`Failed to send email to ${customerEmail}:`, error);
      throw error;
    }
  }
}

module.exports = EmailService;