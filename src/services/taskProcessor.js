const { createLogger } = require('../utils/logger');
const appraisalService = require('./appraisalService');

class TaskProcessor {
  constructor() {
    this.logger = createLogger('TaskProcessor');
    this.processedMessages = new Set();
    this.failedMessages = new Set();
  }

  async processMessage(message) {
    if (this.processedMessages.has(message.id)) {
      this.logger.info(`Skipping duplicate message: ${message.id}`);
      return;
    }

    try {
      const data = JSON.parse(message.data.toString());
      
      this.logger.info('Processing task:', {
        messageId: message.id,
        appraisalId: data.id
      });

      if (!this.validateMessageData(data)) {
        throw new Error('Invalid message data');
      }

      await appraisalService.processAppraisal(
        data.id,
        data.appraisalValue,
        data.description
      );

      this.processedMessages.add(message.id);
      this.cleanupProcessedMessages();

      this.logger.info('Task completed successfully:', {
        messageId: message.id,
        appraisalId: data.id
      });
    } catch (error) {
      this.logger.error('Task processing failed:', {
        messageId: message.id,
        error: error.message
      });
      throw error;
    }
  }

  async addToFailedMessages(message) {
    try {
      const data = JSON.parse(message.data.toString());
      this.failedMessages.add({
        id: message.id,
        data,
        timestamp: new Date().toISOString(),
        retryCount: message.deliveryAttempt || 1
      });
      
      this.logger.info(`Added message ${message.id} to failed messages list`);
      this.cleanupFailedMessages();
    } catch (error) {
      this.logger.error(`Error adding message ${message.id} to failed messages:`, error);
    }
  }

  validateMessageData(data) {
    return (
      data &&
      typeof data.id === 'string' &&
      typeof data.appraisalValue === 'number' &&
      typeof data.description === 'string'
    );
  }

  cleanupProcessedMessages() {
    if (this.processedMessages.size > 1000) {
      const idsToRemove = Array.from(this.processedMessages)
        .slice(0, this.processedMessages.size - 1000);
      idsToRemove.forEach(id => this.processedMessages.delete(id));
    }
  }

  cleanupFailedMessages() {
    // Keep only last 100 failed messages
    if (this.failedMessages.size > 100) {
      const messages = Array.from(this.failedMessages);
      this.failedMessages = new Set(messages.slice(-100));
    }
  }

  getFailedMessages() {
    return Array.from(this.failedMessages);
  }

  async handleError(error, message) {
    this.logger.error('Processing error:', {
      messageId: message.id,
      error: error.message,
      stack: error.stack
    });

    await this.addToFailedMessages(message);
  }
}

module.exports = { TaskProcessor };