const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

async function initializeProcessor() {
  try {
    console.log('Initializing Pub/Sub processor...');
    
    const pubsub = new PubSub({
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
    });

    // Define subscription name
    const topicName = 'appraisal-tasks';
    const subscriptionName = 'appraisal-tasks-subscription';

    console.log(`Checking Pub/Sub topic: ${topicName}`);
    const topic = pubsub.topic(topicName);
    const [topicExists] = await topic.exists();
    
    if (!topicExists) {
      console.error(`Topic ${topicName} does not exist!`);
      throw new Error(`Topic ${topicName} not found`);
    }
    console.log(`Topic ${topicName} found`);

    console.log(`Connecting to Pub/Sub subscription: ${subscriptionName}`);
    const subscription = pubsub.subscription(subscriptionName);
    
    // Verify subscription exists
    const [exists] = await subscription.exists();
    if (!exists) {
      console.log(`Subscription ${subscriptionName} does not exist, creating...`);
      await topic.createSubscription(subscriptionName, {
        ackDeadlineSeconds: 30,
        expirationPolicy: {
          ttl: null
        }
      });
      console.log(`Subscription ${subscriptionName} created successfully`);
    }
    console.log(`Successfully connected to subscription: ${subscriptionName}`);

    const messageHandler = async (message) => {
      let parsedData;
      
      try {
        parsedData = JSON.parse(message.data.toString());
        console.log('New message received:', parsedData);

        if (!parsedData.id) {
          throw new Error('Missing required field: id');
        }

        await taskQueueService.processTask(
          parsedData.id,
          parsedData.appraisalValue,
          parsedData.description
        );
        
        message.ack();
        console.log(`✓ Task processed and acknowledged: ${parsedData.id}`);
      } catch (error) {
        console.error('Error processing message:', error);
        
        if (parsedData?.id) {
          await taskQueueService.handleFailedTask({
            id: parsedData.id,
            error: error.message,
            originalMessage: message.data.toString()
          });
          console.log(`✗ Task failed and moved to DLQ: ${parsedData.id}`);
        } else {
          console.error('Failed to parse message data:', message.data.toString());
        }
        
        message.ack(); // Acknowledge to prevent infinite retries
      }
    };

    // Configure subscription settings
    subscription.on('message', messageHandler);
    subscription.on('error', (error) => {
      console.error('Pub/Sub subscription error:', error);
    });

    // Set up flow control to prevent overwhelming the service
    await subscription.setOptions({
      flowControl: {
        maxMessages: 100,
        allowExcessMessages: false
      }
    });

    console.log('Message handler registered and listening for new messages...');
    console.log('Task Queue processor initialized and actively listening for messages');
  } catch (error) {
    console.error('Error initializing processor:', error);
    throw error;
  }
}

module.exports = { initializeProcessor };