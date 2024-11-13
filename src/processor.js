const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

async function initializeProcessor() {
  try {
    console.log('Initializing Pub/Sub processor...');
    
    const pubsub = new PubSub({
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
    });

    const subscriptionName = 'appraisal-tasks-subscription';
    console.log(`Connecting to Pub/Sub subscription: ${subscriptionName}`);
    
    const subscription = pubsub.subscription(subscriptionName);

    // Verify subscription exists
    const [exists] = await subscription.exists();
    if (!exists) {
      throw new Error(`Subscription ${subscriptionName} does not exist`);
    }
    console.log(`Successfully connected to subscription: ${subscriptionName}`);

    const messageHandler = async (message) => {
      let parsedData;
      
      try {
        parsedData = JSON.parse(message.data.toString());
        console.log('New message received:', { id: parsedData.id, timestamp: new Date().toISOString() });

        const { id, appraisalValue, description } = parsedData;

        if (!id || !appraisalValue || !description) {
          throw new Error('Incomplete task data');
        }

        await taskQueueService.processTask(id, appraisalValue, description);
        message.ack();
        console.log(`✓ Task processed and acknowledged: ${id}`);
      } catch (error) {
        console.error('Error processing message:', error);
        
        if (parsedData) {
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

    subscription.on('message', messageHandler);
    console.log('Message handler registered and listening for new messages...');

    subscription.on('error', (error) => {
      console.error('Pub/Sub subscription error:', error);
    });

    console.log('Task Queue processor initialized and actively listening for messages');
  } catch (error) {
    console.error('Error initializing processor:', error);
    throw error;
  }
}

module.exports = { initializeProcessor };