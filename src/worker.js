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
      
      // Initialize services that require setup
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
      this.logger.info(`Raw message data: ${messageData}`);

      const data = JSON.parse(messageData);
      
      if (data.type !== 'COMPLETE_APPRAISAL' || !data.data?.id || !data.data?.appraisalValue || !data.data?.description) {
        throw new Error('Invalid message format');
      }

      const { id, appraisalValue, description } = data.data;
      this.logger.info(`Processing appraisal ${id}`);

      await this.processAppraisal(id, appraisalValue, description);
      
      // Log success and acknowledge message
      this.logger.info(`Received appraisal data:`, {
        id,
        value: appraisalValue,
        descriptionLength: description.length
      });

      message.ack();
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      await this.publishToDeadLetterQueue(message.id, message.data.toString(), error.message);
      message.ack(); // Acknowledge to prevent retries
    }
  }

  handleError(error) {
    this.logger.error('Subscription error:', error);
  }

  async processAppraisal(id, value, description) {
    try {
      // Step 1: Set Value
      await this.setAppraisalValue(id, value, description);
      
      // Step 2: Merge Descriptions
      const iaDescription = await this.getIADescription(id);
      const mergedDescription = await openaiService.mergeDescriptions(description, iaDescription);
      await this.saveMergedDescription(id, mergedDescription);
      
      // Step 3: Update Title
      const postId = await this.getWordPressPostId(id);
      await wordpressService.updatePost(postId, {
        title: `Appraisal #${id} - ${mergedDescription.substring(0, 100)}...`
      });
      
      // Step 4: Insert Template
      await this.insertTemplate(id, postId);
      
      // Step 5: Build PDF
      const { pdfLink, docLink } = await pdfService.generatePDF(postId);
      await this.updatePDFLinks(id, pdfLink, docLink);
      
      // Step 6: Send Email
      const customerData = await this.getCustomerData(id);
      await emailService.sendAppraisalCompletedEmail(
        customerData.email,
        customerData.name,
        { value, pdfLink, description: mergedDescription }
      );
      
      // Step 7: Complete
      await this.complete(id);
    } catch (error) {
      this.logger.error(`Failed to process appraisal ${id}:`, error);
      throw error;
    }
  }

  async setAppraisalValue(id, value, description) {
    await this.sheetsService.updateValues(`J${id}:K${id}`, [[value, description]]);
  }

  async getIADescription(id) {
    const values = await this.sheetsService.getValues(`H${id}`);
    return values[0][0];
  }

  async saveMergedDescription(id, description) {
    await this.sheetsService.updateValues(`L${id}`, [[description]]);
  }

  async getWordPressPostId(id) {
    try {
      const values = await this.sheetsService.getValues(`G${id}`);
      const wpUrl = values[0][0];
      
      if (!wpUrl) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      // Parse the WordPress admin URL to extract post ID
      const url = new URL(wpUrl);
      const postId = url.searchParams.get('post');
      
      if (!postId) {
        throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
      }

      this.logger.info(`Extracted WordPress post ID: ${postId} from URL: ${wpUrl}`);
      return postId;
    } catch (error) {
      this.logger.error(`Error extracting WordPress post ID for appraisal ${id}:`, error);
      throw error;
    }
  }

  async insertTemplate(id, postId) {
    const values = await this.sheetsService.getValues(`A${id}:B${id}`);
    const appraisalType = values[0][1] || 'RegularArt';
    
    const post = await wordpressService.getPost(postId);
    let content = post.content?.rendered || '';
    
    if (!content.includes('[pdf_download]')) {
      content += '\n[pdf_download]';
    }
    
    if (!content.includes(`[AppraisalTemplates type="${appraisalType}"]`)) {
      content += `\n[AppraisalTemplates type="${appraisalType}"]`;
    }
    
    await wordpressService.updatePost(postId, {
      content,
      acf: { shortcodes_inserted: true }
    });
  }

  async updatePDFLinks(id, pdfLink, docLink) {
    await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]]);
  }

  async getCustomerData(id) {
    const values = await this.sheetsService.getValues(`D${id}:E${id}`);
    return {
      email: values[0][0],
      name: values[0][1]
    };
  }

  async complete(id) {
    await this.sheetsService.updateValues(`F${id}`, [['Completed']]);
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
    if (this.subscription) {
      await this.subscription.close();
      this.logger.info('PubSub worker shut down successfully');
    }
  }
}

// Export a singleton instance
module.exports = new PubSubWorker();