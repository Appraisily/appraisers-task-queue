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
        },
        retryPolicy: {
          minimumBackoff: {
            seconds: 10
          },
          maximumBackoff: {
            seconds: 600
          }
        }
      });
      console.log(`Subscription ${subscriptionName} created successfully`);
    }

    // Get subscription metadata to verify settings
    const [metadata] = await subscription.getMetadata();
    console.log('Subscription metadata:', {
      name: metadata.name,
      topic: metadata.topic,
      pushConfig: metadata.pushConfig,
      ackDeadlineSeconds: metadata.ackDeadlineSeconds,
      messageRetentionDuration: metadata.messageRetentionDuration,
      expirationPolicy: metadata.expirationPolicy
    });

    const messageHandler = async (message) => {
      let parsedData;
      
      try {
        console.log('Raw message received:', message.id);
        console.log('Message attributes:', message.attributes);
        console.log('Message publish time:', message.publishTime);
        
        parsedData = JSON.parse(message.data.toString());
        console.log('Parsed message data:', parsedData);

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
    
    // Enhanced error handling
    subscription.on('error', (error) => {
      console.error('Pub/Sub subscription error:', error);
      // Attempt to reconnect on error
      setTimeout(() => {
        console.log('Attempting to reconnect to Pub/Sub...');
        subscription.removeListener('message', messageHandler);
        subscription.on('message', messageHandler);
      }, 5000);
    });

    // Set up flow control to prevent overwhelming the service
    await subscription.setOptions({
      flowControl: {
        maxMessages: 100,
        allowExcessMessages: false,
        maxExtension: 600
      }
    });

    // Periodic health check
    setInterval(async () => {
      try {
        const [isActive] = await subscription.exists();
        console.log(`Subscription health check - Active: ${isActive}`);
        if (!isActive) {
          throw new Error('Subscription no longer active');
        }
      } catch (error) {
        console.error('Subscription health check failed:', error);
      }
    }, 60000); // Check every minute

    console.log('Message handler registered and actively listening for new messages');
    console.log(`Subscription ${subscriptionName} is ready to process messages`);
  } catch (error) {
    console.error('Error initializing processor:', error);
    throw error;
  }
}

module.exports = { initializeProcessor };