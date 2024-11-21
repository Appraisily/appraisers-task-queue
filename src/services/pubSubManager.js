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
    this.flowControlledSubscription = null;
  }

  async initialize() {
    try {
      this.logger.info('Initializing PubSub connection...', {
        projectId: config.GOOGLE_CLOUD_PROJECT_ID,
        mainTopic: PUBSUB_CONFIG.topics.main
      });

      // Initialize PubSub client with explicit credentials
      this.pubsub = new PubSub({
        projectId: config.GOOGLE_CLOUD_PROJECT_ID,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
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
        stack: error.stack,
        code: error.code,
        details: error.details || 'No additional details'
      });
      await this.handleConnectionError(error);
    }
  }

  async verifyPubSubAccess() {
    try {
      // Log authentication method being used
      this.logger.info('Verifying PubSub authentication...', {
        usingExplicitCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
        projectId: config.GOOGLE_CLOUD_PROJECT_ID
      });

      // Test PubSub API access
      const [projectExists] = await this.pubsub.getProjectId();
      if (!projectExists) {
        throw new Error(`Project ${config.GOOGLE_CLOUD_PROJECT_ID} not found or no access`);
      }
      
      // List all topics to verify permissions
      const [topics] = await this.pubsub.getTopics();
      this.logger.info('Successfully listed topics', {
        topicCount: topics.length
      });
      
      // Verify main topic exists
      const topic = this.pubsub.topic(PUBSUB_CONFIG.topics.main);
      const [exists] = await topic.exists();
      
      if (!exists) {
        this.logger.error(`Required topic ${PUBSUB_CONFIG.topics.main} does not exist`, {
          availableTopics: topics.map(t => t.name)
        });
        throw new Error(`Topic ${PUBSUB_CONFIG.topics.main} not found`);
      }

      this.logger.info('PubSub access verified successfully', {
        topic: PUBSUB_CONFIG.topics.main,
        exists: true
      });
    } catch (error) {
      this.logger.error('PubSub access verification failed:', {
        error: error.message,
        code: error.code,
        details: error.details || 'No additional details',
        stack: error.stack,
        authMethod: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'explicit' : 'implicit'
      });
      throw error;
    }
  }

  // ... rest of the class implementation remains the same ...
}

module.exports = { PubSubManager };