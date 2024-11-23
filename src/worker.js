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
      await pdfService.initialize();

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
        await this.processAppraisal(id, appraisalValue, description);
        message.ack();
      } else {
        throw new Error(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
      await this.publishToDeadLetterQueue(message.id, message.data.toString(), error.message);
      message.ack(); // Acknowledge to prevent infinite retries
    }
  }

  async processAppraisal(id, appraisalValue, description) {
    try {
      // Step 1: Set Value
      await this.setAppraisalValue(id, appraisalValue, description);
      this.logger.info('✓ Value set successfully');

      // Step 2: Merge Descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      this.logger.info('✓ Descriptions merged successfully');

      // Step 3: Update Title
      const postId = await this.updateTitle(id, mergedDescription);
      this.logger.info('✓ Title updated successfully');

      // Step 4: Insert Template
      await this.insertTemplate(id);
      this.logger.info('✓ Template inserted successfully');

      // Step 5: Build PDF
      const { pdfLink, docLink } = await this.buildPdf(id);
      this.logger.info('✓ PDF built successfully');

      // Step 6: Send Email
      await this.sendEmail(id, appraisalValue, description, pdfLink);
      this.logger.info('✓ Email sent successfully');

      // Step 7: Complete
      await this.complete(id);
      this.logger.info('✓ Appraisal marked as complete');

    } catch (error) {
      this.logger.error(`Failed to process appraisal ${id}:`, error);
      throw error;
    }
  }

  async setAppraisalValue(id, appraisalValue, description) {
    // Update Google Sheets
    await this.sheetsService.updateValues(
      `J${id}:K${id}`,
      [[appraisalValue, description]]
    );

    // Get WordPress URL from sheets
    const values = await this.sheetsService.getValues(`G${id}`);
    if (!values?.[0]?.[0]) {
      throw new Error('WordPress URL not found');
    }

    const wpUrl = values[0][0];
    const postId = new URL(wpUrl).searchParams.get('post');

    // Update WordPress
    await wordpressService.updatePost(postId, {
      acf: { value: appraisalValue }
    });
  }

  async mergeDescriptions(id, appraiserDescription) {
    // Get IA description from sheets
    const values = await this.sheetsService.getValues(`H${id}`);
    if (!values?.[0]?.[0]) {
      throw new Error('IA description not found');
    }

    const iaDescription = values[0][0];
    
    // Merge descriptions using OpenAI
    const mergedDescription = await openaiService.mergeDescriptions(
      appraiserDescription,
      iaDescription
    );

    // Save merged description
    await this.sheetsService.updateValues(
      `L${id}`,
      [[mergedDescription]]
    );

    return mergedDescription;
  }

  async updateTitle(id, mergedDescription) {
    // Get WordPress URL
    const values = await this.sheetsService.getValues(`G${id}`);
    if (!values?.[0]?.[0]) {
      throw new Error('WordPress URL not found');
    }

    const wpUrl = values[0][0];
    const postId = new URL(wpUrl).searchParams.get('post');

    // Update WordPress title
    await wordpressService.updatePost(postId, {
      title: `Appraisal #${id} - ${mergedDescription.substring(0, 100)}...`
    });

    return postId;
  }

  async insertTemplate(id) {
    // Get appraisal type and WordPress URL
    const values = await this.sheetsService.getValues(`A${id}:G${id}`);
    if (!values?.[0]) {
      throw new Error('Row data not found');
    }

    const row = values[0];
    const appraisalType = row[1] || 'RegularArt';
    const wpUrl = row[6];
    const postId = new URL(wpUrl).searchParams.get('post');

    // Get current post content
    const post = await wordpressService.getPost(postId);
    let content = post.content?.rendered || '';

    // Add shortcodes if not present
    if (!content.includes('[pdf_download]')) {
      content += '\n[pdf_download]';
    }
    if (!content.includes(`[AppraisalTemplates type="${appraisalType}"]`)) {
      content += `\n[AppraisalTemplates type="${appraisalType}"]`;
    }

    // Update WordPress
    await wordpressService.updatePost(postId, {
      content,
      acf: { shortcodes_inserted: true }
    });
  }

  async buildPdf(id) {
    // Get WordPress data
    const values = await this.sheetsService.getValues(`G${id}`);
    if (!values?.[0]?.[0]) {
      throw new Error('WordPress URL not found');
    }

    const wpUrl = values[0][0];
    const postId = new URL(wpUrl).searchParams.get('post');
    const post = await wordpressService.getPost(postId);

    // Generate PDF
    const { pdfLink, docLink } = await pdfService.generatePDF(
      postId,
      post.acf?.session_id
    );

    // Update sheets with links
    await this.sheetsService.updateValues(
      `M${id}:N${id}`,
      [[pdfLink, docLink]]
    );

    return { pdfLink, docLink };
  }

  async sendEmail(id, appraisalValue, description, pdfLink) {
    // Get customer data
    const values = await this.sheetsService.getValues(`D${id}:E${id}`);
    if (!values?.[0]) {
      throw new Error('Customer data not found');
    }

    const [customerEmail, customerName] = values[0];

    // Send email
    await emailService.sendAppraisalCompletedEmail(
      customerEmail,
      customerName,
      {
        value: appraisalValue,
        description,
        pdfLink
      }
    );
  }

  async complete(id) {
    // Update status to completed
    await this.sheetsService.updateValues(
      `F${id}`,
      [['Completed']]
    );
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

      this.logger.info(`Message ${messageId} published to DLQ`);
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