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
  }

  /**
   * Initialize the CRM service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing CRM service...');
      
      // Get configuration from Secret Manager
      const [projectId, topicName] = await Promise.all([
        secretManager.getSecret('GOOGLE_CLOUD_PROJECT'),
        secretManager.getSecret('PUBSUB_TOPIC_CRM_MESSAGES')
      ]);

      if (!projectId || !topicName) {
        throw new Error('Missing CRM Pub/Sub configuration in Secret Manager');
      }

      this.projectId = projectId;
      this.topicName = topicName;

      // Initialize PubSub client
      this.pubsub = new PubSub({
        projectId: this.projectId
      });
      
      this.topic = this.pubsub.topic(this.topicName);
      this.isInitialized = true;
      
      this.logger.info(`CRM service initialized successfully with topic: ${this.topicName}`);
    } catch (error) {
      this.logger.error('Failed to initialize CRM service:', error);
      throw error;
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
        throw new Error('CRM service not initialized');
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
        origin: 'appraisers-task-queue'
      };
      
      // Convert to Buffer for Pub/Sub
      const messageBuffer = Buffer.from(JSON.stringify(messageData));
      
      this.logger.info(`Sending appraisal ready notification to CRM for ${customerEmail}`);
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