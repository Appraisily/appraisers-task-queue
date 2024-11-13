const fetch = require('node-fetch');
const { config } = require('../config');

class TaskQueueService {
  async processTask(id, appraisalValue, description) {
    try {
      console.log(`Processing task for appraisal ID ${id}`);
      
      // Call appraisers-backend to process the appraisal
      const response = await fetch(`${config.BACKEND_API_URL}/api/appraisals/${id}/complete-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.API_KEY}`
        },
        body: JSON.stringify({
          value: appraisalValue,
          description: description
        })
      });

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.statusText}`);
      }

      console.log(`Task processed successfully for appraisal ID ${id}`);
      return await response.json();
    } catch (error) {
      console.error(`Error processing task for appraisal ${id}:`, error);
      throw error;
    }
  }

  async handleFailedTask(taskData) {
    try {
      console.log(`Handling failed task for appraisal ID ${taskData.id}`);
      
      // Send to DLQ and notify monitoring system
      await this.publishToDLQ(taskData);
      await this.notifyFailure(taskData);
    } catch (error) {
      console.error('Error handling failed task:', error);
      throw error;
    }
  }

  async publishToDLQ(taskData) {
    // Implementation for publishing to Dead Letter Queue
    // This will be handled by the PubSub configuration
    console.log(`Task sent to DLQ: ${JSON.stringify(taskData)}`);
  }

  async notifyFailure(taskData) {
    try {
      await fetch(`${config.BACKEND_API_URL}/api/notifications/task-failure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.API_KEY}`
        },
        body: JSON.stringify({
          appraisalId: taskData.id,
          error: taskData.error
        })
      });
    } catch (error) {
      console.error('Error notifying task failure:', error);
    }
  }
}

module.exports = new TaskQueueService();