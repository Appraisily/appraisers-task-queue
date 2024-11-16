const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

let subscription;
let messageHandler;
let isInitialized = false;
let reconnectAttempts = 0;
let reconnectTimeout;
let isShuttingDown = false;
let keepAliveInterval;
let healthCheckInterval;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RETRY_DELAY = 5000; // 5 seconds
const HEALTH_CHECK_INTERVAL = 15000; // 15 seconds
const SUBSCRIPTION_NAME = 'appraisal-tasks-subscription';

async function checkSubscriptionHealth() {
  try {
    if (!subscription || isShuttingDown) return;

    const [metadata] = await subscription.getMetadata();
    console.log('Subscription health check:', {
      name: metadata.name,
      topic: metadata.topic,
      active: true
    });

    isInitialized = true;
    reconnectAttempts = 0;
  } catch (error) {
    console.error('Health check failed:', error);
    isInitialized = false;
    await reconnectSubscription();
  }
}

async function initializeProcessor() {
  try {
    if (isShuttingDown) {
      console.log('Processor is shutting down, skipping initialization');
      return;
    }

    if (isInitialized) {
      console.log('Processor already initialized, skipping...');
      return;
    }

    console.log('Initializing Pub/Sub processor...');
    
    const pubsub = new PubSub({
      projectId: config.GOOGLE_CLOUD_PROJECT_ID
    });

    const topicName = 'appraisal-tasks';
    const failedTopicName = 'appraisals-failed';
    
    console.log(`Checking Pub/Sub topics...`);
    const topic = pubsub.topic(topicName);
    const [topicExists] = await topic.exists();
    
    if (!topicExists) {
      throw new Error(`Topic ${topicName} not found`);
    }
    console.log(`Topic ${topicName} found`);

    console.log(`Connecting to Pub/Sub subscription...`);

    subscription = topic.subscription(SUBSCRIPTION_NAME);
    const [exists] = await subscription.exists();

    if (!exists) {
      console.log(`Creating new subscription ${SUBSCRIPTION_NAME}...`);
      [subscription] = await topic.createSubscription(SUBSCRIPTION_NAME, {
        ackDeadline: 600,
        messageRetentionDuration: { seconds: 604800 },
        expirationPolicy: { ttl: null },
        enableMessageOrdering: true,
        deadLetterPolicy: {
          deadLetterTopic: `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/topics/${failedTopicName}`,
          maxDeliveryAttempts: 5
        },
        retryPolicy: {
          minimumBackoff: { seconds: 10 },
          maximumBackoff: { seconds: 600 }
        }
      });
    } else {
      console.log(`Using existing subscription ${SUBSCRIPTION_NAME}`);
    }

    messageHandler = async (message) => {
      let parsedData;
      let taskData;
      
      try {
        console.log('Raw message received:', message.id);
        
        parsedData = JSON.parse(message.data.toString());
        console.log('Parsed message data:', parsedData);

        taskData = {
          id: parsedData.id,
          appraisalValue: parsedData.appraisalValue,
          description: parsedData.description
        };

        if (!taskData.id || !taskData.appraisalValue || !taskData.description) {
          throw new Error('Missing required fields in data');
        }

        await taskQueueService.processTask(
          taskData.id,
          taskData.appraisalValue,
          taskData.description,
          message.id
        );
        
        message.ack();
        console.log(`✓ Task processed and acknowledged: ${taskData.id}`);
      } catch (error) {
        console.error('Error processing message:', error);
        message.ack(); // Always acknowledge to prevent infinite retries
        throw error;
      }
    };

    // Set up error handling and automatic reconnection
    subscription.on('error', async (error) => {
      console.error('Pub/Sub subscription error:', error);
      isInitialized = false;
      if (!isShuttingDown) {
        await reconnectSubscription();
      }
    });

    subscription.on('close', async () => {
      console.log('Subscription closed unexpectedly');
      isInitialized = false;
      if (!isShuttingDown) {
        await reconnectSubscription();
      }
    });

    // Set message handler
    subscription.on('message', messageHandler);
    
    // Set up health check interval
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    
    healthCheckInterval = setInterval(async () => {
      await checkSubscriptionHealth();
    }, HEALTH_CHECK_INTERVAL);

    // Set up keep-alive ping
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }
    
    keepAliveInterval = setInterval(async () => {
      try {
        if (!isInitialized && !isShuttingDown) {
          console.log('Keep-alive check: Subscription not initialized, attempting reconnection...');
          await reconnectSubscription();
        } else {
          console.log('Keep-alive check: Subscription is healthy');
        }
      } catch (error) {
        console.error('Error in keep-alive check:', error);
      }
    }, 30000);
    
    console.log('Message handler registered and actively listening for new messages');
    console.log(`Subscription is ready to process messages`);
    
    isInitialized = true;
    reconnectAttempts = 0;
  } catch (error) {
    console.error('Error initializing processor:', error);
    isInitialized = false;
    if (!isShuttingDown) {
      await reconnectSubscription();
    }
  }
}

async function reconnectSubscription() {
  if (isShuttingDown) {
    console.log('System is shutting down, skipping reconnection');
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`);
    process.exit(1);
    return;
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  const delay = Math.min(
    BASE_RETRY_DELAY * Math.pow(2, reconnectAttempts) * (1 + Math.random() * 0.1),
    300000
  );
  
  console.log(`Attempting to reconnect in ${delay/1000} seconds... (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

  reconnectTimeout = setTimeout(async () => {
    try {
      if (subscription) {
        try {
          subscription.removeListener('message', messageHandler);
          await subscription.close();
        } catch (error) {
          console.error('Error closing existing subscription:', error);
        }
      }

      console.log('Attempting to reconnect to Pub/Sub...');
      await initializeProcessor();
      console.log('Successfully reconnected to Pub/Sub');
      reconnectAttempts = 0;
    } catch (error) {
      console.error('Error reconnecting to Pub/Sub:', error);
      reconnectAttempts++;
      if (!isShuttingDown) {
        await reconnectSubscription();
      }
    }
  }, delay);
}

async function closeProcessor() {
  isShuttingDown = true;
  
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  if (subscription && messageHandler) {
    console.log('Closing Pub/Sub subscription...');
    try {
      subscription.removeListener('message', messageHandler);
      await subscription.close();
      isInitialized = false;
      console.log('Pub/Sub subscription closed');
    } catch (error) {
      console.error('Error closing subscription:', error);
      throw error;
    }
  }
}

module.exports = { initializeProcessor, closeProcessor };