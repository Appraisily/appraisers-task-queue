const { createLogger } = require('../utils/logger');
const appraisalService = require('./appraisalService');

class TaskQueueService {
  constructor() {
    this.logger = createLogger('TaskQueueService');
    this.processedMessageIds = new Set();
  }

  async initialize() {
    try {
      await appraisalService.initialize();
      this.logger.info('Task Queue Service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Task Queue Service:', error);
      throw error;
    }
  }

  async processTask(id, appraisalValue, description, messageId) {
    if (this.processedMessageIds.has(messageId)) {
      this.logger.info(`Skipping duplicate message ID: ${messageId}`);
      return;
    }

    try {
      this.logger.info('\n🔔 NEW MESSAGE RECEIVED');
      this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.info('📨 Message ID:', messageId);
      this.logger.info('📋 Task Details:');
      this.logger.info(`   • Appraisal ID: ${id}`);
      this.logger.info(`   • Value: ${appraisalValue}`);
      this.logger.info(`   • Description: ${description}`);
      this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      await appraisalService.processAppraisal(id, appraisalValue, description);

      this.processedMessageIds.add(messageId);
      
      if (this.processedMessageIds.size > 1000) {
        const idsToRemove = Array.from(this.processedMessageIds)
          .slice(0, this.processedMessageIds.size - 1000);
        idsToRemove.forEach(id => this.processedMessageIds.delete(id));
      }

      this.logger.info('\n✅ Task Processed Successfully');
      this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.info(`Appraisal ${id} completed`);
      this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return { success: true, message: 'Appraisal processed successfully' };
    } catch (error) {
      this.logger.error('\n❌ Task Processing Error:');
      this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.error(`Appraisal ID: ${id}`);
      this.logger.error('Error:', error.message);
      this.logger.error('Stack:', error.stack);
      this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      return { success: false, error: error.message };
    }
  }
}

module.exports = new TaskQueueService();