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

      // Get spreadsheet ID from Secret Manager
      const spreadsheetId = await secretManager.getSecret('PENDING_APPRAISALS_SPREADSHEET_ID');
      
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
      const messageData = message.data.toString();
      this.logger.debug('Raw message data:', messageData);
      
      const parsedMessage = JSON.parse(messageData);
      
      if (parsedMessage.type !== 'COMPLETE_APPRAISAL' || !parsedMessage.data) {
        throw new Error('Invalid message format');
      }

      await this.processAppraisal(parsedMessage.data);
      message.ack();
      this.logger.info(`Message ${message.id} processed and acknowledged`);
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      message.ack();
      await this.publishToDeadLetterQueue(message.id, message.data.toString(), error.message);
    }
  }

  async processAppraisal(data) {
    const { id, appraisalValue, description } = data;
    
    if (!id || !appraisalValue || !description) {
      throw new Error('Missing required fields in message');
    }

    this.logger.info(`Processing appraisal ${id}`);

    try {
      // Step 1: Set appraisal value
      await this.setAppraisalValue(id, appraisalValue, description);
      
      // Step 2: Get and merge descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      
      // Step 3: Update WordPress title
      const postId = await this.updateTitle(id, mergedDescription);
      
      // Step 4: Insert template
      await this.insertTemplate(id);
      
      // Step 5: Build PDF
      const { pdfLink, docLink } = await this.buildPdf(id);
      
      // Step 6: Send email
      await this.sendEmail(id, appraisalValue, pdfLink);
      
      // Step 7: Mark as complete
      await this.complete(id);

      this.logger.info(`Successfully processed appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Failed to process appraisal ${id}:`, error);
      throw error;
    }
  }

  async setAppraisalValue(id, value, description) {
    await this.sheetsService.updateValues(
      `Pending!J${id}:K${id}`,
      [[value, description]]
    );
  }

  async mergeDescriptions(id, appraiserDescription) {
    const [iaDescription] = await this.sheetsService.getValues(`Pending!H${id}`);
    const mergedDescription = await openaiService.mergeDescriptions(
      appraiserDescription,
      iaDescription[0]
    );
    await this.sheetsService.updateValues(`Pending!L${id}`, [[mergedDescription]]);
    return mergedDescription;
  }

  async updateTitle(id, description) {
    const [wpUrl] = await this.sheetsService.getValues(`Pending!G${id}`);
    const postId = new URL(wpUrl[0]).searchParams.get('post');
    await wordpressService.updatePost(postId, {
      title: `Appraisal #${id} - ${description.substring(0, 100)}...`
    });
    return postId;
  }

  async insertTemplate(id) {
    const [[type], [wpUrl]] = await this.sheetsService.getValues([
      `Pending!B${id}`,
      `Pending!G${id}`
    ]);
    
    const postId = new URL(wpUrl).searchParams.get('post');
    const post = await wordpressService.getPost(postId);
    
    let content = post.content?.rendered || '';
    if (!content.includes('[pdf_download]')) {
      content += '\n[pdf_download]';
    }
    if (!content.includes(`[AppraisalTemplates type="${type}"]`)) {
      content += `\n[AppraisalTemplates type="${type}"]`;
    }

    await wordpressService.updatePost(postId, {
      content,
      acf: { shortcodes_inserted: true }
    });
  }

  async buildPdf(id) {
    const [[wpUrl]] = await this.sheetsService.getValues(`Pending!G${id}`);
    const postId = new URL(wpUrl).searchParams.get('post');
    const post = await wordpressService.getPost(postId);
    
    const { pdfLink, docLink } = await pdfService.generatePDF(
      postId,
      post.acf?.session_id
    );

    await this.sheetsService.updateValues(
      `Pending!M${id}:N${id}`,
      [[pdfLink, docLink]]
    );

    return { pdfLink, docLink };
  }

  async sendEmail(id, value, pdfLink) {
    const [[email], [name]] = await this.sheetsService.getValues([
      `Pending!D${id}`,
      `Pending!E${id}`
    ]);

    await emailService.sendAppraisalCompletedEmail(email, name, {
      value,
      pdfLink
    });
  }

  async complete(id) {
    await this.sheetsService.updateValues(
      `Pending!F${id}`,
      [['Completed']]
    );
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