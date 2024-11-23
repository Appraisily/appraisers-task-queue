const { PubSub } = require('@google-cloud/pubsub');
const { createLogger } = require('../utils/logger');
const config = require('../config');

const logger = createLogger('PubSub');
let pubsub;
let subscription;

async function initializePubSub(appraisalService) {
  try {
    logger.info('Initializing PubSub connection...');
    
    pubsub = new PubSub({ 
      projectId: config.GOOGLE_CLOUD_PROJECT_ID 
    });

    // Test topic exists
    const topic = pubsub.topic('appraisal-tasks');
    const [exists] = await topic.exists();
    
    if (!exists) {
      throw new Error('Required PubSub topic does not exist');
    }

    subscription = topic.subscription('appraisal-tasks-subscription');
    const [subExists] = await subscription.exists();

    if (!subExists) {
      throw new Error('Required PubSub subscription does not exist');
    }

    // Set up message handler
    subscription.on('message', async (message) => {
      try {
        const data = JSON.parse(message.data.toString());
        logger.info('Processing message:', { messageId: message.id });

        await appraisalService.processAppraisal(
          data.id,
          data.appraisalValue,
          data.description
        );

        message.ack();
        logger.info('Message processed successfully');
      } catch (error) {
        logger.error('Error processing message:', error);
        message.ack(); // Acknowledge to prevent infinite retries
      }
    });

    subscription.on('error', error => {
      logger.error('Subscription error:', error);
    });

    logger.info('PubSub initialized successfully');
    return subscription;
  } catch (error) {
    logger.error('Failed to initialize PubSub:', error);
    throw error;
  }
}

async function shutdownPubSub() {
  if (subscription) {
    try {
      await subscription.close();
      logger.info('PubSub subscription closed');
    } catch (error) {
      logger.error('Error closing subscription:', error);
    }
  }
}

module.exports = {
  initializePubSub,
  shutdownPubSub
};