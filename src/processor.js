const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

async function initializeProcessor() {
  try {
    console.log('Initializing Pub/Sub processor...');
    
    const pubsub = new PubSub({
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
    });

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
    
    const [exists] = await subscription.exists();
    if (!exists) {
      console.log(`Subscription ${subscriptionName} does not exist, creating...`);
      await topic.createSubscription(subscriptionName);
      console.log(`Subscription ${subscriptionName} created successfully`);
    }

    const messageHandler = async (message) => {
      let parsedData;
      
      try {
        console.log('Raw message received:', message.id);
        console.log('Message attributes:', message.attributes);
        console.log('Message publish time:', message.publishTime);
        
        parsedData = JSON.parse(message.data.toString());
        console.log('Parsed message data:', parsedData);

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
        
        if (parsedData?.id) {
          await taskQueueService.handleFailedTask({
            id: parsedData.id,
            error: error.message,
            originalMessage: message.data.toString()
          });
        } else {
          console.error('Failed to parse message data:', message.data.toString());
        }
        
        message.ack(); // Acknowledge to prevent infinite retries
      }
    };

    subscription.on('message', messageHandler);
    
    subscription.on('error', (error) => {
      console.error('Pub/Sub subscription error:', error);
      setTimeout(() => {
        console.log('Attempting to reconnect to Pub/Sub...');
        subscription.removeListener('message', messageHandler);
        subscription.on('message', messageHandler);
      }, 5000);
    });

    console.log('Message handler registered and actively listening for new messages');
    console.log(`Subscription ${subscriptionName} is ready to process messages`);
  } catch (error) {
    console.error('Error initializing processor:', error);
    throw error;
  }
}

module.exports = { initializeProcessor };