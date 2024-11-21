const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { PUBSUB_CONFIG } = require('../config/pubsub.config');
const { TaskProcessor } = require('./taskProcessor');

class PubSubManager {
  constructor() {
    this.logger = createLogger('PubSubManager');
    this.pubsub = new PubSub({ 
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      maxRetries: PUBSUB_CONFIG.retry.maxAttempts
    });
    this.subscription = null;
    this.processor = new TaskProcessor();
    this.retryAttempts = 0;
    this.retryTimeout = null;
    this.isShuttingDown = false;
    this.healthCheckInterval = null;
    this._status = 'initializing';
    this.messageHandler = null;
    this.flowControlledSubscription = null;
  }

  async initialize() {
    try {
      this.logger.info('Initializing PubSub connection...', {
        projectId: config.GOOGLE_CLOUD_PROJECT_ID,
        mainTopic: PUBSUB_CONFIG.topics.main
      });

      await this.verifyPubSubAccess();
      await this.setupSubscription();
      await this.startHealthCheck();
      
      this._status = 'connected';
      this.logger.info('PubSub initialization complete');
    } catch (error) {
      this.logger.error('Failed to initialize PubSub:', {
        error: error.message,
        stack: error.stack,
        code: error.code
      });
      await this.handleConnectionError(error);
    }
  }

  async verifyPubSubAccess() {
    try {
      // Test PubSub API access
      await this.pubsub.getProjectId();
      
      // Verify main topic exists
      const topic = this.pubsub.topic(PUBSUB_CONFIG.topics.main);
      const [exists] = await topic.exists();
      
      if (!exists) {
        this.logger.error(`Required topic ${PUBSUB_CONFIG.topics.main} does not exist`);
        throw new Error(`Topic ${PUBSUB_CONFIG.topics.main} not found`);
      }

      this.logger.info('PubSub access verified successfully');
    } catch (error) {
      this.logger.error('PubSub access verification failed:', {
        error: error.message,
        code: error.code,
        details: error.details
      });
      throw error;
    }
  }

  async setupSubscription() {
    try {
      const topic = this.pubsub.topic(PUBSUB_CONFIG.topics.main);
      
      // Get or create subscription
      this.subscription = topic.subscription(PUBSUB_CONFIG.subscription.name);
      const [subExists] = await this.subscription.exists();

      if (!subExists) {
        this.logger.info('Creating new subscription...', {
          name: PUBSUB_CONFIG.subscription.name
        });

        // Ensure DLQ topic exists
        const deadLetterTopic = this.pubsub.topic(PUBSUB_CONFIG.topics.failed);
        const [dlqExists] = await deadLetterTopic.exists();
        
        if (!dlqExists) {
          this.logger.info('Creating dead letter queue topic...');
          await deadLetterTopic.create();
        }

        const subscriptionConfig = {
          ...PUBSUB_CONFIG.subscription.settings,
          deadLetterPolicy: {
            ...PUBSUB_CONFIG.subscription.settings.deadLetterPolicy,
            deadLetterTopic: deadLetterTopic.name
          }
        };

        [this.subscription] = await topic.createSubscription(
          PUBSUB_CONFIG.subscription.name,
          subscriptionConfig
        );

        this.logger.info('Subscription created successfully');
      } else {
        this.logger.info('Using existing subscription', {
          name: PUBSUB_CONFIG.subscription.name
        });
      }

      // Set up flow control
      this.flowControlledSubscription = this.subscription.setFlowControl(
        PUBSUB_CONFIG.flowControl
      );

      // Create and set up message handler
      if (!this.messageHandler) {
        this.messageHandler = this.createMessageHandler();
      }

      // Clean up existing listeners
      this.subscription.removeAllListeners();
      
      // Add message handler with error boundary
      this.subscription.on('message', async (message) => {
        try {
          await this.messageHandler(message);
        } catch (error) {
          this.logger.error('Error in message handler:', {
            error: error.message,
            messageId: message.id
          });
          message.ack();
        }
      });
      
      // Setup error handlers
      this.setupErrorHandlers();
      
      this.logger.info('Subscription setup complete');
    } catch (error) {
      this.logger.error('Failed to setup subscription:', {
        error: error.message,
        code: error.code,
        details: error.details,
        stack: error.stack
      });
      throw error;
    }
  }

  createMessageHandler() {
    return async (message) => {
      const startTime = Date.now();
      const messageId = message.id;
      
      try {
        this.logger.info(`Processing message ${messageId}`);
        await this.processor.processMessage(message);
        message.ack();
        
        const processingTime = Date.now() - startTime;
        this.logger.info(`Message ${messageId} processed in ${processingTime}ms`);
      } catch (error) {
        const processingTime = Date.now() - startTime;
        this.logger.error(`Error processing message ${messageId}:`, {
          error: error.message,
          processingTime,
          stack: error.stack
        });
        message.ack();
        await this.handleProcessingError(error, message).catch(err => {
          this.logger.error('Error handling processing error:', err);
        });
      }
    };
  }

  setupErrorHandlers() {
    this.subscription.on('error', async (error) => {
      this.logger.error('Subscription error:', {
        error: error.message,
        code: error.code,
        details: error.details
      });
      if (!this.isShuttingDown) {
        await this.handleConnectionError(error);
      }
    });

    this.subscription.on('close', async () => {
      this.logger.warn('Subscription closed unexpectedly');
      if (!this.isShuttingDown) {
        await this.handleConnectionError(new Error('Subscription closed unexpectedly'));
      }
    });

    this.subscription.on('drain', () => {
      this.logger.info('Message backlog cleared');
    });
  }

  async handleConnectionError(error) {
    this._status = 'reconnecting';
    
    if (this.isShuttingDown) {
      this.logger.info('Shutdown in progress, skipping reconnection');
      return;
    }

    const delay = Math.min(
      PUBSUB_CONFIG.retry.initialDelay * 
      Math.pow(PUBSUB_CONFIG.retry.backoffMultiplier, this.retryAttempts),
      PUBSUB_CONFIG.retry.maxDelay
    );

    this.logger.info(`Attempting reconnection in ${delay}ms (attempt ${this.retryAttempts + 1}/${PUBSUB_CONFIG.retry.maxAttempts})`);

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    this.retryTimeout = setTimeout(async () => {
      try {
        await this.reconnect();
        this.retryAttempts = 0;
        this._status = 'connected';
      } catch (retryError) {
        this.logger.error('Reconnection failed:', {
          error: retryError.message,
          attempt: this.retryAttempts + 1,
          nextDelay: delay * 2
        });
        this.retryAttempts++;
        await this.handleConnectionError(retryError);
      }
    }, delay);
  }

  async reconnect() {
    this.logger.info('Attempting to reconnect...');
    
    if (this.subscription) {
      try {
        this.subscription.removeAllListeners();
        await this.subscription.close();
      } catch (error) {
        this.logger.warn('Error closing existing subscription:', error);
      }
    }

    await this.verifyPubSubAccess();
    await this.setupSubscription();
    this.logger.info('Successfully reconnected');
  }

  // Rest of the class implementation remains the same...
  // (including handleProcessingError, startHealthCheck, shutdown, handleError, isHealthy, and getStatus methods)
}

module.exports = { PubSubManager };