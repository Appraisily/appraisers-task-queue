const OpenAI = require('openai');
const { getSecret } = require('../utils/secretManager');
const { createLogger } = require('../utils/logger');

class OpenAIService {
  constructor() {
    this.logger = createLogger('OpenAIService');
    this.client = null;
  }

  async initialize() {
    try {
      // Use exact secret name from README
      const apiKey = await getSecret('OPENAI_API_KEY');
      this.client = new OpenAI({ apiKey });
      this.logger.info('OpenAI service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI service:', error);
      throw error;
    }
  }

  // Rest of the code remains the same...
}