const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

/**
 * Service for sending notifications to CRM via Google Cloud Pub/Sub
 */
class CrmService {
  constructor() {
    this.logger = createLogger('CrmService');
    this.pubsub = null;
    this.topic = null;
    this.isInitialized = false;
    this.projectId = null;
    this.topicName = null;
    this.subscriptionName = process.env.PUBSUB_SUBSCRIPTION_NAME || 'CRM-tasks';
  }

  /**
   * Initialize the CRM service
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    try {
      this.logger.info('Initializing CRM service...');
      
      // Get configuration from Secret Manager
      let projectId, topicName;
      
      try {
        [projectId, topicName] = await Promise.all([
          secretManager.getSecret('GOOGLE_CLOUD_PROJECT'),
          secretManager.getSecret('PUBSUB_TOPIC_CRM_MESSAGES')
        ]);
      } catch (secretError) {
        this.logger.warn(`Failed to load CRM configuration from Secret Manager: ${secretError.message}`);
        this.logger.info('CRM service will run in limited mode (notifications disabled)');
        return true; // Still return success, but service will be in limited mode
      }

      if (!projectId || !topicName) {
        this.logger.warn('Missing CRM Pub/Sub configuration in Secret Manager');
        this.logger.info('CRM service will run in limited mode (notifications disabled)');
        return true; // Still return success, but service will be in limited mode
      }

      this.projectId = projectId;
      this.topicName = topicName;

      // Initialize PubSub client
      this.pubsub = new PubSub({
        projectId: this.projectId
      });
      
      this.topic = this.pubsub.topic(this.topicName);
      this.logger.info(`CRM service initialized successfully with topic: ${this.topicName}, subscription: ${this.subscriptionName}`);
      this.isInitialized = true;
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize CRM service:', error);
      this.logger.info('CRM service will run in limited mode (notifications disabled)');
      return true; // Still return success to avoid blocking application startup
    }
  }

  /**
   * Send an appraisal ready notification to the CRM system
   * @param {string} customerEmail - Customer's email address
   * @param {string} customerName - Customer's name
   * @param {string} sessionId - Session ID of the appraisal
   * @param {string} pdfLink - URL to the PDF version of the appraisal
   * @param {string} wpLink - URL to the WordPress page with the appraisal content
   * @returns {Promise<Object>} - Notification result with messageId and timestamp
   */
  async sendAppraisalReadyNotification(customerEmail, customerName, sessionId, pdfLink, wpLink) {
    try {
      if (!this.isInitialized) {
        this.logger.warn('CRM service not fully initialized, skipping notification');
        return { 
          messageId: 'SKIPPED', 
          timestamp: new Date().toISOString(),
          message: 'CRM service not initialized'
        };
      }
      
      if (!customerEmail) {
        this.logger.warn('No valid email provided, skipping notification');
        return { messageId: 'NA', timestamp: new Date().toISOString() };
      }
      
      // Validate PDF link to prevent sending notifications with placeholder or invalid URLs
      if (!pdfLink || pdfLink.includes('placeholder')) {
        this.logger.error(`Cannot send notification with invalid PDF link: ${pdfLink}`);
        throw new Error('Invalid PDF link - cannot send notification with placeholder URL');
      }
      
      // Prepare message data structure according to CRM requirements
      const messageData = {
        processType: 'appraisalReadyNotification',
        customer: {
          email: customerEmail,
          name: customerName || 'Customer'
        },
        sessionId: sessionId || `appraisal_${Date.now()}`,
        pdf_link: pdfLink,
        wp_link: wpLink || '',
        timestamp: new Date().toISOString(),
        origin: 'appraisers-task-queue',
        subscriptionName: this.subscriptionName
      };
      
      // Convert to Buffer for Pub/Sub
      const messageBuffer = Buffer.from(JSON.stringify(messageData));
      
      this.logger.info(`Sending appraisal ready notification to CRM for ${customerEmail} via ${this.subscriptionName}`);
      const messageId = await this.topic.publish(messageBuffer);
      
      this.logger.info(`Notification sent successfully, Message ID: ${messageId}`);
      
      return {
        messageId: messageId || 'success',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Error sending notification to CRM for ${customerEmail}:`, error);
      
      // Return a special error status instead of throwing
      // This allows the process to continue even if notification fails
      return {
        messageId: 'ERROR',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

module.exports = CrmService; 