const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

let subscription;
let messageHandler;
let isInitialized = false;
let reconnectAttempts = 0;
let reconnectTimeout;
let isShuttingDown = false;

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
    subscription = topic.subscription('appraisal-tasks-subscription');
    
    const [exists] = await subscription.exists();
    if (!exists) {
      console.log(`Subscription does not exist, creating...`);
      await topic.createSubscription('appraisal-tasks-subscription');
      console.log(`Subscription created successfully`);
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

        // Extract task data directly from parsed message
        taskData = {
          id: parsedData.id,
          appraisalValue: parsedData.appraisalValue,
          description: parsedData.description
        };

        // Validate required fields
        if (!taskData.id || !taskData.appraisalValue || !taskData.description) {
          throw new Error('Missing required fields in data: id, appraisalValue, or description');
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
    
    console.log('Message handler registered and actively listening for new messages');
    console.log(`Subscription is ready to process messages`);
    
    isInitialized = true;
    reconnectAttempts = 0; // Reset attempts on successful connection
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

  // Clear any existing timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  // Exponential backoff starting at 5 seconds, max 2 minutes
  const backoffTime = Math.min(5000 * Math.pow(2, reconnectAttempts), 120000);
  console.log(`Attempting to reconnect in ${backoffTime/1000} seconds... (attempt ${reconnectAttempts + 1})`);

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
  }, backoffTime);
}

async function closeProcessor() {
  isShuttingDown = true;
  
  // Clear any pending reconnection attempts
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