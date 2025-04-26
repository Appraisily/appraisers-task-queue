const sgMail = require('@sendgrid/mail');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

/**
 * Service for sending emails through SendGrid
 */
class EmailService {
  constructor() {
    this.logger = createLogger('EmailService');
    this.fromEmail = null;
    this.completedTemplateId = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the Email service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing Email service...');
      
      const [apiKey, fromEmail, completedTemplateId] = await Promise.all([
        secretManager.getSecret('SENDGRID_API_KEY'),
        secretManager.getSecret('SENDGRID_EMAIL'),
        secretManager.getSecret('SEND_GRID_TEMPLATE_NOTIFY_APPRAISAL_COMPLETED')
      ]);

      if (!apiKey || !fromEmail || !completedTemplateId) {
        throw new Error('Missing SendGrid configuration in Secret Manager');
      }

      // Set API key for SendGrid
      sgMail.setApiKey(apiKey);
      
      this.fromEmail = fromEmail;
      this.completedTemplateId = completedTemplateId;
      this.isInitialized = true;
      
      this.logger.info('Email service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Email service:', error);
      throw error;
    }
  }

  /**
   * Send an email notification when an appraisal is completed
   * @param {string} to - Recipient's email address
   * @param {string} name - Recipient's name
   * @param {Object} data - Template data including PDF link and appraisal URL
   * @returns {Promise<Object>} - Email send result with messageId and timestamp
   */
  async sendAppraisalCompletedEmail(to, name, data) {
    try {
      if (!this.isInitialized) {
        throw new Error('Email service not initialized');
      }
      
      if (!to || to === 'NA') {
        this.logger.warn('No valid email provided, skipping email notification');
        return { messageId: 'NA', timestamp: new Date().toISOString() };
      }
      
      const { pdfLink, appraisalUrl } = data;
      
      // Validate PDF link to prevent sending emails with placeholder or invalid URLs
      if (!pdfLink || pdfLink.includes('placeholder')) {
        this.logger.error(`Cannot send email with invalid PDF link: ${pdfLink}`);
        throw new Error('Invalid PDF link - cannot send email with placeholder URL');
      }
      
      const currentYear = new Date().getFullYear();
      
      const msg = {
        to,
        from: this.fromEmail,
        templateId: this.completedTemplateId,
        dynamicTemplateData: {
          customer_name: name || 'Customer',
          pdf_link: pdfLink,
          wp_link: appraisalUrl,
          current_year: currentYear,
        }
      };
      
      this.logger.info(`Sending appraisal completed email to ${to} with PDF link: ${pdfLink}`);
      const [response] = await sgMail.send(msg);
      
      this.logger.info(`Email sent successfully, ID: ${response?.messageId}`);
      
      return {
        messageId: response?.messageId || 'success',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Error sending email to ${to}:`, error);
      
      // Return a special error status instead of throwing
      // This allows the process to continue even if email fails
      return {
        messageId: 'ERROR',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

module.exports = EmailService;