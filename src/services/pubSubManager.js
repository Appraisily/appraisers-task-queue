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
      this.logger.info('Initializing PubSub connection...');
      await this.setupSubscription();
      await this.startHealthCheck();
      this._status = 'connected';
      this.logger.info('PubSub initialization complete');
    } catch (error) {
      this.logger.error('Failed to initialize PubSub:', error);
      await this.handleConnectionError(error);
    }
  }

  async setupSubscription() {
    try {
      const topic = this.pubsub.topic(PUBSUB_CONFIG.topics.main);
      const [exists] = await topic.exists();
      
      if (!exists) {
        throw new Error(`Required topic ${PUBSUB_CONFIG.topics.main} does not exist`);
      }

      // Create or get subscription
      this.subscription = topic.subscription(PUBSUB_CONFIG.subscription.name);
      const [subExists] = await this.subscription.exists();

      if (!subExists) {
        this.logger.info('Creating new subscription...');
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
          this.logger.error('Error in message handler:', error);
          // Ensure message is acked to prevent infinite retries
          message.ack();
        }
      });
      
      // Setup error handlers
      this.setupErrorHandlers();
      
      this.logger.info('Subscription setup complete');
    } catch (error) {
      this.logger.error('Failed to setup subscription:', error);
      throw error;
    }
  }

  createMessageHandler() {
    return async (message) => {
      const startTime = Date.now();
      try {
        this.logger.info(`Processing message ${message.id}`);
        await this.processor.processMessage(message);
        message.ack();
        
        const processingTime = Date.now() - startTime;
        this.logger.info(`Message ${message.id} processed in ${processingTime}ms`);
      } catch (error) {
        const processingTime = Date.now() - startTime;
        this.logger.error(`Error processing message ${message.id} after ${processingTime}ms:`, error);
        message.ack(); // Always acknowledge to prevent infinite retries
        await this.handleProcessingError(error, message).catch(err => {
          this.logger.error('Error handling processing error:', err);
        });
      }
    };
  }

  setupErrorHandlers() {
    this.subscription.on('error', async (error) => {
      this.logger.error('Subscription error:', error);
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

    // Handle backpressure
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

    if (this.retryAttempts >= PUBSUB_CONFIG.retry.maxAttempts) {
      this.logger.error('Max retry attempts reached');
      // Instead of exiting, keep trying with max delay
      this.retryAttempts = PUBSUB_CONFIG.retry.maxAttempts;
    }

    const delay = Math.min(
      PUBSUB_CONFIG.retry.initialDelay * 
      Math.pow(PUBSUB_CONFIG.retry.backoffMultiplier, this.retryAttempts),
      PUBSUB_CONFIG.retry.maxDelay
    );

    this.logger.info(`Attempting reconnection in ${delay}ms (attempt ${this.retryAttempts + 1})`);

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    this.retryTimeout = setTimeout(async () => {
      try {
        await this.reconnect();
        this.retryAttempts = 0;
        this._status = 'connected';
      } catch (retryError) {
        this.logger.error('Reconnection failed:', retryError);
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

    await this.setupSubscription();
    this.logger.info('Successfully reconnected');
  }

  async handleProcessingError(error, message) {
    try {
      await this.processor.handleError(error, message);
    } catch (handlingError) {
      this.logger.error('Error handling failed message:', handlingError);
    }
  }

  async startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.subscription) {
          const [metadata] = await this.subscription.getMetadata();
          this.logger.debug('Health check passed:', metadata.name);
          
          // Verify message handler attachment
          if (!this.subscription.listenerCount('message')) {
            this.logger.warn('No message handler found, reattaching...');
            if (this.messageHandler) {
              this.subscription.on('message', this.messageHandler);
            } else {
              this.logger.error('Message handler is null, recreating...');
              this.messageHandler = this.createMessageHandler();
              this.subscription.on('message', this.messageHandler);
            }
          }
        } else {
          throw new Error('Subscription is null');
        }
      } catch (error) {
        this.logger.error('Health check failed:', error);
        await this.handleConnectionError(error);
      }
    }, PUBSUB_CONFIG.healthCheck.interval);
  }

  async shutdown() {
    this.isShuttingDown = true;
    this._status = 'shutting_down';
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    // Wait for in-flight messages to complete
    if (this.subscription) {
      try {
        this.logger.info('Waiting for in-flight messages to complete...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        this.subscription.removeAllListeners();
        await this.subscription.close();
        this.logger.info('Subscription closed gracefully');
      } catch (error) {
        this.logger.error('Error during graceful shutdown:', error);
      }
    }
  }

  handleError(error) {
    if (!this.isShuttingDown) {
      this.logger.error('System error detected:', error);
      this.handleConnectionError(error).catch(err => {
        this.logger.error('Error handling connection error:', err);
      });
    }
  }

  isHealthy() {
    return this._status === 'connected' && 
           this.subscription !== null && 
           this.subscription.listenerCount('message') > 0;
  }

  getStatus() {
    return {
      status: this._status,
      retryAttempts: this.retryAttempts,
      hasMessageHandler: this.messageHandler !== null,
      listenerCount: this.subscription?.listenerCount('message') ?? 0
    };
  }
}

module.exports = { PubSubManager };