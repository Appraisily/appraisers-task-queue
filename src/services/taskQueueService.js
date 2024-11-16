const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { config } = require('../config');
const appraisalService = require('./appraisalService');

class TaskQueueService {
  constructor() {
    this.processedMessageIds = new Set();
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

      await appraisalService.processAppraisal(id, appraisalValue, description);

      // Add message ID to processed set after successful processing
      this.processedMessageIds.add(messageId);
      
      // Cleanup old message IDs (keep last 1000)
      if (this.processedMessageIds.size > 1000) {
        const idsToRemove = Array.from(this.processedMessageIds).slice(0, this.processedMessageIds.size - 1000);
        idsToRemove.forEach(id => this.processedMessageIds.delete(id));
      }

      console.log('\n✅ Task Processed Successfully');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Appraisal ${id} completed`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return { success: true, message: 'Appraisal processed successfully' };
    } catch (error) {
      console.error('\n❌ Task Processing Error:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`Appraisal ID: ${id}`);
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      // Don't rethrow the error - this prevents the subscription from closing
      return { success: false, error: error.message };
    }
  }
}

module.exports = new TaskQueueService();