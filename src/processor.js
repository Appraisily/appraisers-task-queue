const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

let subscription;
let messageHandler;
let pubsub;

async function initializeProcessor() {
  try {
    console.log('Initializing Pub/Sub processor...');
    
    pubsub = new PubSub({
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

    // Close existing subscription if it exists
    if (messageHandler) {
      console.log('Closing existing subscription...');
      await subscription.removeListener('message', messageHandler);
    }

    messageHandler = async (message) => {
      let parsedData;
      
      try {
        console.log('Raw message received:', message.id);
        console.log('Message attributes:', message.attributes);
        console.log('Message publish time:', message.publishTime);
        
        parsedData = JSON.parse(message.data.toString());
        console.log('Parsed message data:', parsedData);

        // Validate required fields
        if (!parsedData.id || !parsedData.appraisalValue || !parsedData.description) {
          throw new Error('Missing required fields: id, appraisalValue, or description');
        }

        await taskQueueService.processTask(
          parsedData.id,
          parsedData.appraisalValue,
          parsedData.description,
          message.id
        );
        
        message.ack();
        console.log(`✓ Task processed and acknowledged: ${parsedData.id}`);
      } catch (error) {
        console.error('Error processing message:', error);
        
        try {
          // Move failed messages to the error topic
          const failedMessage = {
            id: parsedData?.id || 'unknown',
            originalMessage: message.data.toString(),
            error: error.message,
            timestamp: new Date().toISOString()
          };
          
          await failedTopic.publish(Buffer.from(JSON.stringify(failedMessage)));
          console.log(`Message moved to failed topic: ${failedMessage.id}`);
          
          // Acknowledge the message to prevent it from blocking the queue
          message.ack();
          console.log('Failed message acknowledged and moved to error topic');
        } catch (pubsubError) {
          console.error('Error publishing to failed topic:', pubsubError);
          message.ack();
          console.log('Message acknowledged despite error publishing to failed topic');
        }
      }
    };

    // Configure subscription settings with error handling
    subscription.setOptions({
      flowControl: {
        maxMessages: 1,
        allowExcessMessages: false
      }
    });
    
    // Add error handler for subscription
    subscription.on('error', async (error) => {
      console.error('Pub/Sub subscription error:', error);
      await reconnectSubscription();
    });

    subscription.on('message', messageHandler);
    
    console.log('Message handler registered and actively listening for new messages');
    console.log(`Subscription is ready to process messages`);
  } catch (error) {
    console.error('Error initializing processor:', error);
    throw error;
  }
}

async function reconnectSubscription() {
  try {
    console.log('Attempting to reconnect to Pub/Sub...');
    if (messageHandler && subscription) {
      await subscription.removeListener('message', messageHandler);
    }
    await initializeProcessor();
    console.log('Successfully reconnected to Pub/Sub');
  } catch (error) {
    console.error('Error reconnecting to Pub/Sub:', error);
    setTimeout(reconnectSubscription, 5000);
  }
}

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Cleaning up...');
  if (messageHandler && subscription) {
    await subscription.removeListener('message', messageHandler);
  }
  process.exit(0);
});

module.exports = { initializeProcessor };