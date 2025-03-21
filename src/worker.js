const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('./utils/logger');
const secretManager = require('./utils/secrets');
const SheetsService = require('./services/sheets.service');
const WordPressService = require('./services/wordpress.service');
const OpenAIService = require('./services/openai');
const EmailService = require('./services/email');
const PDFService = require('./services/pdf');
const AppraisalService = require('./services/appraisal.service');

class PubSubWorker {
  constructor() {
    this.logger = createLogger('PubSubWorker');
    this.subscription = null;
    this.sheetsService = new SheetsService();
    this.appraisalService = null;
    this.activeProcesses = new Set();
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      this.logger.info('Initializing PubSub worker...');

      // Initialize Secret Manager first
      await secretManager.initialize();

      // Get spreadsheet ID from Secret Manager
      const spreadsheetId = await secretManager.getSecret('PENDING_APPRAISALS_SPREADSHEET_ID');
      if (!spreadsheetId) {
        throw new Error('Failed to get spreadsheet ID from Secret Manager');
      }

      this.logger.info(`Using spreadsheet ID: ${spreadsheetId}`);
      
      // Initialize all services
      await this.sheetsService.initialize({ PENDING_APPRAISALS_SPREADSHEET_ID: spreadsheetId });
      const wordpressService = new WordPressService();
      const openaiService = new OpenAIService();
      const emailService = new EmailService();
      const pdfService = new PDFService();
      
      await Promise.all([
        wordpressService.initialize(),
        openaiService.initialize(),
        emailService.initialize(),
        pdfService.initialize()
      ]);
      
      // Initialize AppraisalService with all dependencies
      this.appraisalService = new AppraisalService(
        this.sheetsService,
        wordpressService,
        openaiService,
        emailService,
        pdfService
      );

      // Initialize PubSub
      const pubsub = new PubSub();
      const topicName = 'appraisal-tasks';
      const subscriptionName = 'appraisal-tasks-subscription';

      // Get or create topic
      const [topic] = await pubsub.topic(topicName).get({ autoCreate: true });
      this.logger.info(`Connected to topic: ${topicName}`);

      // Get or create subscription
      [this.subscription] = await topic.subscription(subscriptionName).get({
        autoCreate: true,
        enableMessageOrdering: true
      });

      this.logger.info(`Connected to subscription: ${subscriptionName}`);

      // Configure message handler
      this.subscription.on('message', this.handleMessage.bind(this));
      this.subscription.on('error', this.handleError.bind(this));

      this.logger.info('PubSub worker initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize PubSub worker:', error);
      throw error;
    }
  }

  async handleMessage(message) {
    // If shutting down, don't accept new messages
    if (this.isShuttingDown) {
      this.logger.info('Worker is shutting down, message will be redelivered later');
      return;
    }

    const processId = `${message.id}-${Date.now()}`;
    this.activeProcesses.add(processId);

    try {
      this.logger.info(`Processing message ${message.id}`);
      const messageData = message.data.toString();
      this.logger.info(`Raw message data: ${messageData}`);

      const parsedMessage = JSON.parse(messageData);
      
      if (parsedMessage.type !== 'COMPLETE_APPRAISAL' || !parsedMessage.data?.id || !parsedMessage.data?.appraisalValue || !parsedMessage.data?.description) {
        throw new Error('Invalid message format');
      }

      const { id, appraisalValue, description, appraisalType } = parsedMessage.data;
      
      // Validate appraisal type if provided
      if (appraisalType && !['Regular', 'IRS', 'Insurance'].includes(appraisalType)) {
        this.logger.warn(`Invalid appraisal type "${appraisalType}" in message, will use type from spreadsheet`);
        await this.appraisalService.processAppraisal(id, appraisalValue, description, null);
      } else {
        await this.appraisalService.processAppraisal(id, appraisalValue, description, appraisalType);
      }
      this.logger.info(`Processing appraisal ${id}`);

      
      this.logger.info(`Successfully processed appraisal ${id}`);
      message.ack();
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      await this.publishToDeadLetterQueue(message.id, message.data.toString(), error.message);
      message.ack(); // Acknowledge to prevent retries
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  handleError(error) {
    this.logger.error('Subscription error:', error);
  }

  async publishToDeadLetterQueue(messageId, data, errorMessage) {
    try {
      const pubsub = new PubSub();
      const dlqTopic = pubsub.topic('appraisals-failed');
      
      await dlqTopic.publish(Buffer.from(JSON.stringify({
        originalMessageId: messageId,
        data: data,
        error: errorMessage,
        timestamp: new Date().toISOString()
      })));
      
      this.logger.info(`Message ${messageId} published to DLQ`);
    } catch (error) {
      this.logger.error('Failed to publish to DLQ:', error);
    }
  }

  async shutdown() {
    this.isShuttingDown = true;
    this.logger.info('Starting graceful shutdown...');

    // Stop accepting new messages
    if (this.subscription) {
      this.subscription.removeAllListeners('message');
    }

    // Wait for active processes to complete
    if (this.activeProcesses.size > 0) {
      this.logger.info(`Waiting for ${this.activeProcesses.size} active processes to complete...`);
      
      // Check every second if processes are done
      while (this.activeProcesses.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.logger.info(`Remaining processes: ${this.activeProcesses.size}`);
      }
    }

    // Close subscription
    if (this.subscription) {
      await this.subscription.close();
      this.logger.info('PubSub subscription closed');
    }

    this.logger.info('PubSub worker shut down successfully');
  }
}

// Export a singleton instance
module.exports = new PubSubWorker();