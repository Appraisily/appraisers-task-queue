const fetch = require('node-fetch');
const { config } = require('../config');

class TaskQueueService {
  async processTask(id, appraisalValue, description) {
    try {
      console.log(`Processing task for appraisal ID ${id}`);
      
      const response = await fetch(`${config.BACKEND_API_URL}/api/appraisals/${id}/complete-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          value: appraisalValue,
          description: description
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend API error: ${response.statusText} - ${errorText}`);
      }

      console.log(`Task processed successfully for appraisal ID ${id}`);
      return await response.json();
    } catch (error) {
      console.error(`Error processing task for appraisal ${id}:`, error);
      throw error;
    }
  }

  async handleFailedTask(taskData) {
    if (!taskData || !taskData.id) {
      console.error('Invalid task data received:', taskData);
      return;
    }

    try {
      console.log(`Handling failed task for appraisal ID ${taskData.id}`);
      await this.notifyFailure(taskData);
    } catch (error) {
      console.error('Error handling failed task:', error);
    }
  }

  async notifyFailure(taskData) {
    try {
      const response = await fetch(`${config.BACKEND_API_URL}/api/notifications/task-failure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appraisalId: taskData.id,
          error: taskData.error
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notification API error: ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error notifying task failure:', error);
      throw error;
    }
  }
}

module.exports = new TaskQueueService();