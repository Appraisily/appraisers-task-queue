const { createLogger } = require('../utils/logger');
const appraisalService = require('./appraisalService');

class TaskQueueService {
  constructor() {
    this.logger = createLogger('TaskQueueService');
    this.processedMessageIds = new Set();
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) {
      return;
    }

    try {
      await appraisalService.initialize();
      this._initialized = true;
      this.logger.info('Task Queue Service initialized');
    } catch (error) {
      this._initialized = false;
      this.logger.error('Failed to initialize Task Queue Service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this._initialized;
  }

  async processTask(id, appraisalValue, description, messageId) {
    if (!this._initialized) {
      throw new Error('Task Queue Service not initialized');
    }

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
      this.cleanupProcessedMessages();

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
      
      throw error;
    }
  }

  cleanupProcessedMessages() {
    if (this.processedMessageIds.size > 1000) {
      const idsToRemove = Array.from(this.processedMessageIds)
        .slice(0, this.processedMessageIds.size - 1000);
      idsToRemove.forEach(id => this.processedMessageIds.delete(id));
    }
  }
}

module.exports = new TaskQueueService();