const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const { initializeSheets } = require('./services/googleSheets');
const appraisalService = require('./services/appraisalService');

async function initializeProcessor() {
  try {
    const sheets = await initializeSheets();
    const pubsub = new PubSub({
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
    });

    const subscriptionName = 'appraisal-tasks-subscription';
    const subscription = pubsub.subscription(subscriptionName);

    const messageHandler = async (message) => {
      try {
        const data = JSON.parse(message.data.toString());
        console.log('Message received:', data);

        const { id, appraisalValue, description } = data;

        if (!id || !appraisalValue || !description) {
          throw new Error('Incomplete data in message.');
        }

        await appraisalService.processAppraisal(id, appraisalValue, description);
        message.ack();
        console.log(`Message processed and acknowledged: ${id}`);
      } catch (error) {
        console.error('Error processing message:', error);
        await publishToFailedTopic(message.data.toString());
        message.ack();
      }
    };

    subscription.on('message', messageHandler);
    subscription.on('error', (error) => {
      console.error('Pub/Sub subscription error:', error);
    });

    console.log('Task Queue processor initialized successfully');
  } catch (error) {
    console.error('Error initializing processor:', error);
    throw error;
  }
}

async function publishToFailedTopic(messageData) {
  try {
    const pubsub = new PubSub({
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
    });
    
    const failedTopicName = 'appraisals-failed';
    const failedTopic = pubsub.topic(failedTopicName);

    const [exists] = await failedTopic.exists();
    if (!exists) {
      await failedTopic.create();
    }

    await failedTopic.publish(Buffer.from(messageData));
  } catch (error) {
    console.error('Error publishing to failed topic:', error);
  }
}

module.exports = { initializeProcessor };