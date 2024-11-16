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
      pushConfig: metadata.pushConfig,
      messageRetentionDuration: metadata.messageRetentionDuration,
      active: true
    });

    // If we get here, the subscription is healthy
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
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      maxRetries: 5,
      retry: {
        retries: 5,
        maxRetries: 5,
        maxRetryDelay: 60000, // 1 minute
        totalTimeout: 600000 // 10 minutes
      }
    });

    const topicName = 'appraisal-tasks';
    const failedTopicName = 'appraisals-failed';
    
    console.log(`Checking Pub/Sub topics...`);
    const topic = pubsub.topic(topicName);
    const failedTopic = pubsub.topic(failedTopicName);
    const [topicExists] = await topic.exists();
    
    if (!topicExists) {
      throw new Error(`Topic ${topicName} not found`);
    }
    console.log(`Topic ${topicName} found`);

    console.log(`Connecting to Pub/Sub subscription...`);

    // Configure subscription with proper settings
    const subscriptionConfig = {
      name: SUBSCRIPTION_NAME,
      topic: topicName,
      ackDeadline: 600, // 10 minutes
      messageRetentionDuration: { seconds: 604800 }, // 7 days
      expirationPolicy: { ttl: null }, // Never expire
      enableMessageOrdering: true,
      deadLetterPolicy: {
        deadLetterTopic: `projects/${config.GOOGLE_CLOUD_PROJECT_ID}/topics/${failedTopicName}`,
        maxDeliveryAttempts: 5
      },
      retryPolicy: {
        minimumBackoff: { seconds: 10 },
        maximumBackoff: { seconds: 600 }
      }
    };

    subscription = topic.subscription(SUBSCRIPTION_NAME, {
      flowControl: {
        maxMessages: 100,
        allowExcessMessages: false,
        maxExtension: 600
      },
      ackDeadline: 600, // 10 minutes
      streamingOptions: {
        maxStreams: 5,
        timeout: 600000 // 10 minutes
      }
    });
    
    const [exists] = await subscription.exists();
    if (!exists) {
      console.log(`Subscription does not exist, creating...`);
      [subscription] = await topic.createSubscription(SUBSCRIPTION_NAME, subscriptionConfig);
      console.log(`Subscription created successfully`);
    } else {
      // Update existing subscription settings
      const [metadata] = await subscription.getMetadata();
      await subscription.setMetadata({
        ...metadata,
        ...subscriptionConfig
      });
    }

    messageHandler = async (message) => {
      let parsedData;
      let taskData;
      
      try {
        console.log('Raw message received:', message.id);
        console.log('Message attributes:', message.attributes);
        console.log('Message publish time:', message.publishTime);
        
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
        
        try {
          const failedMessage = {
            id: taskData?.id || parsedData?.id || 'unknown',
            originalMessage: message.data.toString(),
            error: error.message,
            timestamp: new Date().toISOString()
          };
          
          await failedTopic.publish(Buffer.from(JSON.stringify(failedMessage)));
          console.log(`Message moved to failed topic: ${failedMessage.id}`);
          
          message.ack();
          console.log('Failed message acknowledged and moved to error topic');
        } catch (pubsubError) {
          console.error('Error publishing to failed topic:', pubsubError);
          message.ack();
          console.log('Message acknowledged despite error publishing to failed topic');
        }
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

    // Set message handler and enable flow control
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
    }, 30000); // Check every 30 seconds
    
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
    process.exit(1); // Force restart through Cloud Run
    return;
  }

  // Clear any existing timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  // Exponential backoff with jitter
  const delay = Math.min(
    BASE_RETRY_DELAY * Math.pow(2, reconnectAttempts) * (1 + Math.random() * 0.1),
    300000 // Max 5 minutes
  );
  
  console.log(`Attempting to reconnect in ${delay/1000} seconds... (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

  reconnectTimeout = setTimeout(async () => {
    try {
      if (subscription) {
        try {
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
  
  // Clear intervals and timeouts
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