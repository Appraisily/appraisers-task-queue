const { PubSub } = require('@google-cloud/pubsub');
const { config } = require('./config');
const taskQueueService = require('./services/taskQueueService');

async function initializeProcessor() {
  try {
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
          throw new Error('Incomplete task data');
        }

        await taskQueueService.processTask(id, appraisalValue, description);
        message.ack();
        console.log(`Task processed and acknowledged: ${id}`);
      } catch (error) {
        console.error('Error processing message:', error);
        const taskData = {
          id: data?.id,
          error: error.message,
          originalMessage: message.data.toString()
        };
        await taskQueueService.handleFailedTask(taskData);
        message.ack(); // Acknowledge to prevent infinite retries
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

module.exports = { initializeProcessor };