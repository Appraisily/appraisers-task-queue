const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const taskQueueService = require('./taskQueueService');

const SUBSCRIPTION_NAME = 'appraisal-tasks-subscription';
const MAX_RETRY_ATTEMPTS = 10;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const GRACEFUL_SHUTDOWN_TIMEOUT = 30000;

class PubSubManager {
  constructor() {
    this.logger = createLogger('PubSubManager');
    this.pubsub = null;
    this.subscription = null;
    this.retryAttempts = 0;
    this.retryTimeout = null;
    this.isShuttingDown = false;
    this.healthCheckInterval = null;
    this._status = 'initializing';
    this.activeMessages = new Set();
    this.shutdownTimer = null;
  }

  async initialize() {
    try {
      if (!config.initialized) {
        throw new Error('Configuration not initialized');
      }

      if (!taskQueueService.isInitialized()) {
        throw new Error('Task Queue Service not initialized');
      }

      this.logger.info('Initializing PubSub connection...');
      
      this.pubsub = new PubSub({ 
        projectId: config.GOOGLE_CLOUD_PROJECT_ID 
      });

      await this.setupSubscription();
      await this.startHealthCheck();
      
      this._status = 'connected';
      this.logger.info('PubSub initialization complete');
    } catch (error) {
      this._status = 'error';
      this.logger.error('Failed to initialize PubSub:', error);
      throw error;
    }
  }

  async setupSubscription() {
    try {
      const topic = this.pubsub.topic('appraisal-tasks');
      const [exists] = await topic.exists();
      
      if (!exists) {
        throw new Error('Required topic does not exist');
      }

      this.subscription = topic.subscription(SUBSCRIPTION_NAME);
      const [subExists] = await this.subscription.exists();

      if (!subExists) {
        this.logger.info('Creating new subscription...');
        [this.subscription] = await topic.createSubscription(SUBSCRIPTION_NAME, {
          ackDeadlineSeconds: 600,
          messageRetentionDuration: { seconds: 604800 },
          expirationPolicy: { ttl: null },
          enableMessageOrdering: true,
          deadLetterPolicy: {
            deadLetterTopic: `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/topics/appraisals-failed`,
            maxDeliveryAttempts: 5
          },
          retryPolicy: {
            minimumBackoff: { seconds: 10 },
            maximumBackoff: { seconds: 600 }
          }
        });
      }

      this.setupMessageHandler();
      this.setupErrorHandlers();
    } catch (error) {
      this.logger.error('Failed to setup subscription:', error);
      throw error;
    }
  }

  setupMessageHandler() {
    this.subscription.on('message', async (message) => {
      this.activeMessages.add(message.id);
      
      try {
        this.logger.info(`Processing message ${message.id}`);
        
        const data = JSON.parse(message.data.toString());
        if (!this.validateMessageData(data)) {
          throw new Error('Invalid message data structure');
        }

        const { id, appraisalValue, description } = data.data;
        await taskQueueService.processTask(id, appraisalValue, description, message.id);
        
        message.ack();
        this.logger.info(`Message ${message.id} processed successfully`);
      } catch (error) {
        this.logger.error(`Error processing message ${message.id}:`, error);
        message.ack(); // Always ack to prevent infinite retries
      } finally {
        this.activeMessages.delete(message.id);
        
        if (this.isShuttingDown && this.activeMessages.size === 0) {
          this.completeShutdown();
        }
      }
    });
  }

  validateMessageData(messageData) {
    if (!messageData || typeof messageData !== 'object') return false;
    if (messageData.type !== 'COMPLETE_APPRAISAL') return false;
    if (!messageData.data || typeof messageData.data !== 'object') return false;

    const { id, appraisalValue, description } = messageData.data;

    return (
      typeof id === 'string' &&
      typeof appraisalValue === 'number' &&
      typeof description === 'string' &&
      id.trim() !== '' &&
      !isNaN(appraisalValue) &&
      description.trim() !== ''
    );
  }

  setupErrorHandlers() {
    this.subscription.on('error', async (error) => {
      this.logger.error('Subscription error:', error);
      await this.handleConnectionError(error);
    });

    this.subscription.on('close', async () => {
      this.logger.warn('Subscription closed unexpectedly');
      if (!this.isShuttingDown) {
        await this.handleConnectionError(new Error('Subscription closed'));
      }
    });
  }

  async handleConnectionError(error) {
    this._status = 'reconnecting';
    
    if (this.isShuttingDown) {
      this.logger.info('Shutdown in progress, skipping reconnection');
      return;
    }

    if (this.retryAttempts >= MAX_RETRY_ATTEMPTS) {
      this.logger.error('Max retry attempts reached, exiting process');
      process.exit(1);
      return;
    }

    const delay = Math.min(
      INITIAL_RETRY_DELAY * Math.pow(2, this.retryAttempts),
      MAX_RETRY_DELAY
    );

    this.logger.info(`Attempting reconnection in ${delay}ms (attempt ${this.retryAttempts + 1}/${MAX_RETRY_ATTEMPTS})`);

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
        await this.subscription.close();
      } catch (error) {
        this.logger.warn('Error closing existing subscription:', error);
      }
    }

    await this.setupSubscription();
    this.logger.info('Successfully reconnected');
  }

  async startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.subscription && !this.isShuttingDown) {
          const [metadata] = await this.subscription.getMetadata();
          this.logger.debug('Health check passed:', metadata.name);
        }
      } catch (error) {
        this.logger.error('Health check failed:', error);
        await this.handleConnectionError(error);
      }
    }, 30000);
  }

  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this._status = 'shutting_down';
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
    }

    const activeCount = this.activeMessages.size;
    if (activeCount > 0) {
      this.logger.info(`Waiting for ${activeCount} active messages to complete...`);
      
      this.shutdownTimer = setTimeout(() => {
        this.logger.warn('Graceful shutdown timeout reached, forcing exit');
        this.completeShutdown();
      }, GRACEFUL_SHUTDOWN_TIMEOUT);
    } else {
      await this.completeShutdown();
    }
  }

  async completeShutdown() {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
    }

    if (this.subscription) {
      try {
        await this.subscription.close();
        this.logger.info('Subscription closed');
      } catch (error) {
        this.logger.error('Error closing subscription:', error);
      }
    }

    this.isShuttingDown = false;
    this._status = 'shutdown';
  }

  isHealthy() {
    return this._status === 'connected';
  }

  getStatus() {
    return this._status;
  }
}

module.exports = { PubSubManager };