const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { config } = require('../config');

class TaskQueueService {
  generateAuthToken() {
    try {
      if (!config.JWT_SECRET) {
        throw new Error('JWT secret not initialized');
      }
      const token = jwt.sign({ service: 'task-queue' }, config.JWT_SECRET, { expiresIn: '1h' });
      console.log('JWT token generated successfully');
      return token;
    } catch (error) {
      console.error('Failed to generate JWT token:', error);
      throw error;
    }
  }

  async processTask(id, appraisalValue, description) {
    try {
      console.log(`Processing task for appraisal ID ${id}`);
      console.log('Task data:', { id, appraisalValue, description });
      
      const token = this.generateAuthToken();
      console.log('Authorization token generated');
      
      const url = `${config.BACKEND_API_URL}/api/appraisals/${id}/complete-process`;
      console.log('Making request to:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          value: appraisalValue,
          description: description
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend response error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`Backend API error: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`Task processed successfully for appraisal ID ${id}`, result);
      return result;
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
      const token = this.generateAuthToken();
      console.log('Notifying task failure with token');
      
      const response = await fetch(`${config.BACKEND_API_URL}/api/notifications/task-failure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          appraisalId: taskData.id,
          error: taskData.error
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Notification error response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`Notification API error: ${response.statusText} - ${errorText}`);
      }

      console.log('Task failure notification sent successfully');
    } catch (error) {
      console.error('Error notifying task failure:', error);
      throw error;
    }
  }
}

module.exports = new TaskQueueService();