const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('./utils/logger');
const secretManager = require('./utils/secrets');
const SheetsService = require('./services/sheets.service');
const wordpressService = require('./services/wordpress');
const openaiService = require('./services/openai');
const emailService = require('./services/email');
const pdfService = require('./services/pdf');

class PubSubWorker {
  constructor() {
    this.logger = createLogger('PubSubWorker');
    this.subscription = null;
    this.sheetsService = new SheetsService();
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
      await wordpressService.initialize();
      await openaiService.initialize();
      await emailService.initialize();

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
    try {
      this.logger.info(`Processing message ${message.id}`);
      const rawData = message.data.toString();
      this.logger.info(`Raw message data: ${rawData}`);

      const data = JSON.parse(rawData);
      
      if (!data.type || !data.data) {
        throw new Error('Invalid message format');
      }

      if (data.type === 'COMPLETE_APPRAISAL') {
        const { id, appraisalValue, description } = data.data;
        
        if (!id || !appraisalValue || !description) {
          throw new Error('Missing required fields in message');
        }

        this.logger.info(`Processing appraisal ${id}`);
        
        // Process the appraisal
        this.logger.info('Processing steps will be implemented here');
        
        // For now, just log the data
        this.logger.info('Received appraisal data:', {
          id,
          value: appraisalValue,
          descriptionLength: description.length
        });

        // Acknowledge the message
        message.ack();
      } else {
        throw new Error(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      await this.publishToDeadLetterQueue(message.id, rawData, error.message);
      message.ack(); // Acknowledge to prevent infinite retries
    }
  }

  async handleError(error) {
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
    } catch (error) {
      this.logger.error('Failed to publish to DLQ:', error);
    }
  }

  async shutdown() {
    if (this.subscription) {
      try {
        await this.subscription.close();
        this.logger.info('PubSub worker shut down successfully');
      } catch (error) {
        this.logger.error('Error shutting down PubSub worker:', error);
        throw error;
      }
    }
  }
}

// Export a single instance
module.exports = new PubSubWorker();