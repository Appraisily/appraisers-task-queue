const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { PUBSUB_CONFIG } = require('../config/pubsub.config');
const { TaskProcessor } = require('./taskProcessor');

class PubSubManager {
  constructor() {
    this.logger = createLogger('PubSubManager');
    this.pubsub = null;
    this.subscription = null;
    this.processor = new TaskProcessor();
    this.retryAttempts = 0;
    this.retryTimeout = null;
    this.isShuttingDown = false;
    this.healthCheckInterval = null;
    this._status = 'initializing';
    this.messageHandler = null;
  }

  async initialize() {
    try {
      this.logger.info('Initializing PubSub connection...');

      this.pubsub = new PubSub({
        projectId: config.GOOGLE_CLOUD_PROJECT_ID,
        credentials: config.PUBSUB_CREDENTIALS,
        maxRetries: PUBSUB_CONFIG.retry.maxAttempts
      });

      await this.verifyPubSubAccess();
      await this.setupSubscription();
      await this.startHealthCheck();
      
      this._status = 'connected';
      this.logger.info('PubSub initialization complete');
    } catch (error) {
      this.logger.error('Failed to initialize PubSub:', {
        error: error.message,
        stack: error.stack
      });
      await this.handleConnectionError(error);
    }
  }

  async verifyPubSubAccess() {
    try {
      const topic = this.pubsub.topic(PUBSUB_CONFIG.topics.main);
      const [exists] = await topic.exists();
      
      if (!exists) {
        throw new Error(`Topic ${PUBSUB_CONFIG.topics.main} not found`);
      }

      this.logger.info('PubSub access verified successfully');
    } catch (error) {
      this.logger.error('PubSub access verification failed:', {
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }

  async setupSubscription() {
    try {
      const topic = this.pubsub.topic(PUBSUB_CONFIG.topics.main);
      this.subscription = topic.subscription(PUBSUB_CONFIG.subscription.name, {
        flowControl: PUBSUB_CONFIG.flowControl
      });
      
      const [exists] = await this.subscription.exists();
      if (!exists) {
        [this.subscription] = await topic.createSubscription(
          PUBSUB_CONFIG.subscription.name,
          PUBSUB_CONFIG.subscription.settings
        );
      }

      this.messageHandler = async (message) => {
        try {
          await this.processor.processMessage(message);
          message.ack();
        } catch (error) {
          this.logger.error('Error processing message:', {
            messageId: message.id,
            error: error.message
          });
          message.ack(); // Always acknowledge to prevent infinite retries
          await this.handleMessageError(message, error);
        }
      };

      this.subscription.on('message', this.messageHandler);
      this.subscription.on('error', this.handleSubscriptionError.bind(this));

      this.logger.info('Subscription setup complete');
    } catch (error) {
      this.logger.error('Failed to setup subscription:', {
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }

  async handleConnectionError(error) {
    if (this.isShuttingDown) return;

    const delay = Math.min(
      PUBSUB_CONFIG.retry.initialDelay * Math.pow(PUBSUB_CONFIG.retry.backoffMultiplier, this.retryAttempts),
      PUBSUB_CONFIG.retry.maxDelay
    );

    this.retryAttempts++;
    
    if (this.retryAttempts <= PUBSUB_CONFIG.retry.maxAttempts) {
      this.logger.info(`Attempting reconnection in ${delay}ms (attempt ${this.retryAttempts}/${PUBSUB_CONFIG.retry.maxAttempts})`);
      
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
      }

      this.retryTimeout = setTimeout(async () => {
        try {
          this._status = 'reconnecting';
          await this.initialize();
          this.retryAttempts = 0;
        } catch (retryError) {
          await this.handleConnectionError(retryError);
        }
      }, delay);
    } else {
      this.logger.error('Max retry attempts reached. Manual intervention required.');
      this._status = 'failed';
      process.exit(1);
    }
  }

  async handleSubscriptionError(error) {
    this.logger.error('Subscription error:', {
      error: error.message,
      code: error.code
    });
    
    if (!this.isShuttingDown) {
      await this.handleConnectionError(error);
    }
  }

  async handleMessageError(message, error) {
    try {
      const failedTopic = this.pubsub.topic(PUBSUB_CONFIG.topics.failed);
      const [exists] = await failedTopic.exists();
      
      if (!exists) {
        await failedTopic.create();
      }

      await failedTopic.publish(message.data);
      
      this.logger.info('Message moved to failed topic', {
        messageId: message.id,
        failedTopic: PUBSUB_CONFIG.topics.failed
      });
    } catch (dlqError) {
      this.logger.error('Failed to move message to DLQ:', {
        messageId: message.id,
        error: dlqError.message
      });
    }
  }

  async startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (!this.subscription || this.isShuttingDown) return;

        const [metadata] = await this.subscription.getMetadata();
        this.logger.debug('Health check passed', { subscription: metadata.name });
      } catch (error) {
        this.logger.error('Health check failed:', {
          error: error.message,
          code: error.code
        });
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

    if (this.subscription && this.messageHandler) {
      this.subscription.removeListener('message', this.messageHandler);
      await this.subscription.close();
      this.logger.info('Subscription closed');
    }

    this._status = 'shutdown';
  }

  handleError(error) {
    this.logger.error('System error:', {
      error: error.message,
      stack: error.stack
    });
    
    if (!this.isShuttingDown) {
      this.handleConnectionError(error);
    }
  }

  isHealthy() {
    return this._status === 'connected';
  }

  getStatus() {
    return this._status;
  }
}

module.exports = { PubSubManager };