const { PubSub } = require('@google-cloud/pubsub');
const { google } = require('googleapis');
const { createLogger } = require('./utils/logger');

class PubSubWorker {
  constructor() {
    this.logger = createLogger('PubSubWorker');
    this.subscription = null;
    this.sheets = null;
    this.spreadsheetId = process.env.PENDING_APPRAISALS_SPREADSHEET_ID;
  }

  async initialize() {
    try {
      this.logger.info('Initializing PubSub worker...');
      
      // Initialize Google Sheets
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ 
        version: 'v4', 
        auth: await auth.getClient()
      });

      // Test sheets connection
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'properties.title'
      });
      
      this.logger.info('Sheets connection established');

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
    const messageData = message.data.toString();
    
    try {
      this.logger.info(`Processing message ${message.id}`);
      this.logger.debug('Raw message data:', messageData);
      
      // Parse the JSON message
      const parsedMessage = JSON.parse(messageData);
      
      if (parsedMessage.type !== 'COMPLETE_APPRAISAL' || !parsedMessage.data) {
        throw new Error('Invalid message type or missing data');
      }

      // Process the appraisal task
      await this.processAppraisal(parsedMessage.data);

      // Acknowledge the message
      message.ack();
      this.logger.info(`Message ${message.id} processed and acknowledged`);
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      
      // Always acknowledge to prevent infinite retries
      message.ack();
      
      // Publish to dead letter queue
      await this.publishToDeadLetterQueue(message.id, messageData, error.message);
    }
  }

  async processAppraisal(data) {
    const { id, appraisalValue, description } = data;
    
    if (!id || appraisalValue === undefined || !description) {
      throw new Error(`Invalid message data: missing required fields. Received: ${JSON.stringify(data)}`);
    }

    this.logger.info(`Processing appraisal ${id}`);
    
    try {
      // Step 1: Update appraisal value and description in sheets
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Pending!J${id}:K${id}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[appraisalValue, description]]
        }
      });
      this.logger.info('Updated value and description');

      // Step 2: Update status to completed
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Pending!F${id}`,
        valueInputOption: 'RAW',
        resource: {
          values: [['Completed']]
        }
      });
      this.logger.info('Updated status to completed');

      this.logger.info(`Successfully processed appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Failed to process appraisal ${id}:`, error);
      throw error;
    }
  }

  async publishToDeadLetterQueue(messageId, originalMessage, errorMessage) {
    try {
      const pubsub = new PubSub();
      const dlqTopic = pubsub.topic('appraisals-failed');
      
      const messageData = {
        originalMessage,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        messageId
      };

      await dlqTopic.publish(Buffer.from(JSON.stringify(messageData)));
      this.logger.info(`Message ${messageId} published to DLQ`);
    } catch (dlqError) {
      this.logger.error('Failed to publish to DLQ:', dlqError);
    }
  }

  handleError(error) {
    this.logger.error('Subscription error:', error);
  }

  async shutdown() {
    if (this.subscription) {
      try {
        await this.subscription.close();
        this.logger.info('PubSub worker shut down successfully');
      } catch (error) {
        this.logger.error('Error shutting down PubSub worker:', error);
      }
    }
  }
}

module.exports = new PubSubWorker();