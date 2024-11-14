const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { config } = require('../config');

class TaskQueueService {
  constructor() {
    this.processedMessageIds = new Set();
  }

  generateAuthToken() {
    try {
      if (!config.JWT_SECRET) {
        throw new Error('JWT secret not initialized');
      }
      const token = jwt.sign(
        { role: 'worker' },
        config.JWT_SECRET,
        { expiresIn: '1h' }
      );
      console.log('Worker JWT token generated successfully');
      return token;
    } catch (error) {
      console.error('Failed to generate worker JWT token:', error);
      throw error;
    }
  }

  async processTask(id, appraisalValue, description, messageId) {
    // Skip if we've already processed this message
    if (this.processedMessageIds.has(messageId)) {
      console.log(`Skipping already processed message: ${messageId}`);
      return;
    }

    try {
      console.log(`Processing task for appraisal ID ${id}`);
      console.log('Task data:', { id, appraisalValue, description });
      
      const token = this.generateAuthToken();
      console.log('Worker authorization token generated');
      
      const url = `${config.BACKEND_API_URL}/api/appraisals/${id}/complete-process`;
      console.log('Making request to:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          appraisalValue,
          description
        })
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('Backend response error:', {
          status: response.status,
          statusText: response.statusText,
          error: responseData
        });
        throw new Error(`Backend API error: ${response.statusText} - ${JSON.stringify(responseData)}`);
      }

      console.log(`Task processed successfully for appraisal ID ${id}`, responseData);
      
      // Add message ID to processed set after successful processing
      this.processedMessageIds.add(messageId);
      
      // Cleanup old message IDs (keep last 1000)
      if (this.processedMessageIds.size > 1000) {
        const idsToRemove = Array.from(this.processedMessageIds).slice(0, this.processedMessageIds.size - 1000);
        idsToRemove.forEach(id => this.processedMessageIds.delete(id));
      }

      return responseData;
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
      console.log(`✗ Task failed and moved to DLQ: ${taskData.id}`);
    } catch (error) {
      console.error('Error handling failed task:', error);
    }
  }

  async notifyFailure(taskData) {
    try {
      const token = this.generateAuthToken();
      console.log('Notifying task failure with worker token');
      
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

      const responseData = await response.json();

      if (!response.ok) {
        console.error('Notification error response:', {
          status: response.status,
          statusText: response.statusText,
          error: responseData
        });
        throw new Error(`Notification API error: ${response.statusText} - ${JSON.stringify(responseData)}`);
      }

      console.log('Task failure notification sent successfully');
    } catch (error) {
      console.error('Error notifying task failure:', error);
      throw error;
    }
  }
}

module.exports = new TaskQueueService();