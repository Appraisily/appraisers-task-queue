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
      return token;
    } catch (error) {
      console.error('Failed to generate worker JWT token:', error);
      throw error;
    }
  }

  async processTask(id, appraisalValue, description, messageId) {
    // Skip if we've already processed this message
    if (this.processedMessageIds.has(messageId)) {
      console.log(`📝 Skipping duplicate message ID: ${messageId}`);
      return;
    }

    try {
      console.log('\n🔔 NEW MESSAGE RECEIVED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📨 Message ID:', messageId);
      console.log('📋 Task Details:');
      console.log(`   • Appraisal ID: ${id}`);
      console.log(`   • Value: ${appraisalValue}`);
      console.log(`   • Description: ${description}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const token = this.generateAuthToken();
      
      const url = `${config.BACKEND_API_URL}/api/appraisals/process-worker`;
      console.log('🌐 Sending request to:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          id,
          appraisalValue,
          description
        })
      });

      const responseData = await response.json();

      if (!response.ok || !responseData.success) {
        console.error('\n❌ Backend Response Error:');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`Status: ${response.status} (${response.statusText})`);
        console.error('Error:', responseData);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        throw new Error(responseData.message || `Backend API error: ${response.statusText}`);
      }

      console.log('\n✅ Task Processed Successfully');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Response:', responseData);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      // Add message ID to processed set after successful processing
      this.processedMessageIds.add(messageId);
      
      // Cleanup old message IDs (keep last 1000)
      if (this.processedMessageIds.size > 1000) {
        const idsToRemove = Array.from(this.processedMessageIds).slice(0, this.processedMessageIds.size - 1000);
        idsToRemove.forEach(id => this.processedMessageIds.delete(id));
      }

      return responseData;
    } catch (error) {
      console.error('\n❌ Task Processing Error:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`Appraisal ID: ${id}`);
      console.error('Error:', error.message);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      throw error;
    }
  }

  async handleFailedTask(taskData) {
    if (!taskData || !taskData.id) {
      console.error('❌ Invalid task data received:', taskData);
      return;
    }

    try {
      console.log(`⚠️ Handling failed task for appraisal ID ${taskData.id}`);
      await this.notifyFailure(taskData);
      console.log(`📤 Task moved to DLQ: ${taskData.id}`);
    } catch (error) {
      console.error('❌ Error handling failed task:', error);
    }
  }

  async notifyFailure(taskData) {
    try {
      const token = this.generateAuthToken();
      
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
        console.error('\n❌ Notification Error:');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`Status: ${response.status} (${response.statusText})`);
        console.error('Error:', responseData);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        throw new Error(`Notification API error: ${response.statusText}`);
      }

      console.log('✅ Task failure notification sent successfully');
    } catch (error) {
      console.error('❌ Error notifying task failure:', error);
      throw error;
    }
  }
}

module.exports = new TaskQueueService();