const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('./utils/logger');

class PubSubWorker {
  constructor() {
    this.logger = createLogger('PubSubWorker');
    this.subscription = null;
    this.isProcessing = false;
  }

  async initialize() {
    try {
      this.logger.info('Initializing PubSub worker...');
      
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
      
      const data = JSON.parse(message.data.toString());
      this.logger.info('Message data:', data);

      const { id, appraisalValue, description } = data;

      if (!id || !appraisalValue || !description) {
        throw new Error('Missing required fields in message');
      }

      // Process the appraisal task
      await this.processAppraisal(id, appraisalValue, description);

      // Acknowledge the message
      message.ack();
      this.logger.info(`Message ${message.id} processed and acknowledged`);
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      
      // Always acknowledge to prevent infinite retries
      // Failed messages will be handled by the dead letter queue
      message.ack();
      
      // Publish to dead letter queue
      await this.publishToDeadLetterQueue(message);
    }
  }

  async processAppraisal(id, appraisalValue, description) {
    this.logger.info(`Processing appraisal ${id}`);
    
    try {
      // 1. Set appraisal value
      await this.setAppraisalValue(id, appraisalValue, description);
      this.logger.info('✓ Value set');

      // 2. Merge descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      this.logger.info('✓ Descriptions merged');

      // 3. Update title
      await this.updateTitle(id, mergedDescription);
      this.logger.info('✓ Title updated');

      // 4. Insert template
      await this.insertTemplate(id);
      this.logger.info('✓ Template inserted');

      // 5. Build PDF
      await this.buildPdf(id);
      this.logger.info('✓ PDF built');

      // 6. Send email
      await this.sendEmail(id);
      this.logger.info('✓ Email sent');

      // 7. Mark as complete
      await this.complete(id);
      this.logger.info('✓ Appraisal completed');

    } catch (error) {
      this.logger.error(`Failed to process appraisal ${id}:`, error);
      throw error;
    }
  }

  async publishToDeadLetterQueue(message) {
    try {
      const pubsub = new PubSub();
      const dlqTopic = pubsub.topic('appraisals-failed');
      
      const messageData = {
        originalMessage: message.data.toString(),
        error: error.message,
        timestamp: new Date().toISOString()
      };

      await dlqTopic.publish(Buffer.from(JSON.stringify(messageData)));
      this.logger.info(`Message ${message.id} published to DLQ`);
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