const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('./utils/logger');
const secretManager = require('./utils/secrets');
const SheetsService = require('./services/sheets.service');
const WordPressService = require('./services/wordpress.service');
const OpenAIService = require('./services/openai.service');
const EmailService = require('./services/email.service');
const PDFService = require('./services/pdf.service');
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

  /**
   * Queue a request to process an appraisal from a specific step
   * @param {string|number} id - Appraisal ID
   * @param {string} startStep - Step to start processing from
   * @param {object} options - Additional options
   * @returns {Promise<void>}
   */
  async queueStepProcessing(id, startStep, options = {}) {
    if (this.isShuttingDown) {
      this.logger.warn('Worker is shutting down, rejecting new processing request');
      throw new Error('Service is shutting down, try again later');
    }

    try {
      this.logger.info(`Queueing appraisal ${id} for processing from step ${startStep}`);
      
      // Create a PubSub client
      const pubsub = new PubSub();
      const topicName = 'appraisal-tasks';
      
      // Prepare the message
      const message = {
        type: 'PROCESS_FROM_STEP',
        data: {
          id,
          startStep,
          ...(Object.keys(options).length > 0 ? { options } : {})
        }
      };
      
      // Publish to PubSub
      const dataBuffer = Buffer.from(JSON.stringify(message));
      const messageId = await pubsub.topic(topicName).publish(dataBuffer);
      
      this.logger.info(`Successfully queued appraisal ${id} for processing from step ${startStep}, message ID: ${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error(`Error queueing step processing for appraisal ${id}:`, error);
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

      // Parse the message data
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(messageData);
      } catch (parseError) {
        throw new Error(`Invalid JSON format: ${parseError.message}`);
      }
      
      // Check message type and handle accordingly
      if (parsedMessage.type === 'PROCESS_FROM_STEP') {
        // Handle step-by-step processing
        const { id, startStep, options = {} } = parsedMessage.data;
        
        if (!id || !startStep) {
          throw new Error('Missing required fields for step processing: id and startStep');
        }
        
        this.logger.info(`Processing appraisal ${id} from step ${startStep}`);
        
        // Extract any additional data from options that might be needed
        const { appraisalValue, description, appraisalType } = options;
        
        // Process based on step
        switch (startStep) {
          case 'STEP_SET_VALUE':
            // First step, so we need all fields
            if (!appraisalValue && !description) {
              throw new Error('Missing required fields for STEP_SET_VALUE: appraisalValue or description');
            }
            // Start full processing
            await this.appraisalService.processAppraisal(id, appraisalValue, description, appraisalType);
            break;
            
          case 'STEP_MERGE_DESCRIPTIONS':
            // Need description at minimum
            if (!this.appraisalService) {
              throw new Error('Appraisal service not initialized');
            }
            // Need to get existing data
            const existingData = await this.sheetsService.getValues(`J${id}:K${id}`);
            if (!existingData || !existingData[0]) {
              throw new Error('No existing data found for appraisal');
            }
            const [value, existingDescription] = existingData[0];
            // Use provided description or existing one
            const descToUse = description || existingDescription;
            if (!descToUse) {
              throw new Error('No description provided or found for merge step');
            }
            
            await this.appraisalService.mergeDescriptions(id, descToUse);
            // Continue processing from here
            // TODO: Implement step-by-step processing logic
            break;
            
          default:
            // For now, just attempt to run the full process
            this.logger.warn(`Full step-by-step processing not implemented yet. Starting from ${startStep}`);
            // This will fail if essential data is missing - implement proper step handlers
            await this.appraisalService.processAppraisal(id, appraisalValue, description, appraisalType);
        }
          
        this.logger.info(`Successfully processed appraisal ${id} from step ${startStep}`);
      } else if (parsedMessage.type === 'COMPLETE_APPRAISAL') {
        // Handle regular complete appraisal request
        // Validate required fields
        const missingFields = [];
        if (!parsedMessage.data) missingFields.push('data');
        if (parsedMessage.data) {
          if (!parsedMessage.data.id) missingFields.push('id');
          if (!parsedMessage.data.appraisalValue) missingFields.push('appraisalValue');
          if (!parsedMessage.data.description) missingFields.push('description');
        }
        
        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        const { id, appraisalValue, description, appraisalType } = parsedMessage.data;
        
        // Validate appraisal type if provided
        const validTypes = ['Regular', 'IRS', 'Insurance'];
        if (appraisalType && !validTypes.includes(appraisalType)) {
          this.logger.warn(`Invalid appraisal type "${appraisalType}" in message, will use type from spreadsheet. Valid types: ${validTypes.join(', ')}`);
          await this.appraisalService.processAppraisal(id, appraisalValue, description, null);
        } else {
          await this.appraisalService.processAppraisal(id, appraisalValue, description, appraisalType);
        }
        this.logger.info(`Processing appraisal ${id}`);
      } else {
        throw new Error(`Unknown message type: ${parsedMessage.type}. Expected 'COMPLETE_APPRAISAL' or 'PROCESS_FROM_STEP'`);
      }
      
      this.logger.info(`Successfully processed message ${message.id}`);
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
      
      // Standard message format documentation
      const correctMessageFormat = {
        type: 'COMPLETE_APPRAISAL',
        data: {
          id: 'String - Unique identifier for the appraisal',
          appraisalValue: 'Number - Monetary value of the appraisal',
          description: 'String - Detailed description of the appraisable item',
          appraisalType: 'String (optional) - Must be one of: Regular, IRS, Insurance'
        }
      };
      
      await dlqTopic.publish(Buffer.from(JSON.stringify({
        originalMessageId: messageId,
        data: data,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        correctFormat: correctMessageFormat,
        documentation: 'For more details, visit the /api/docs endpoint'
      })));
      
      this.logger.info(`Message ${messageId} published to DLQ with documentation`);
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