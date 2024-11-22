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
      const apiKey = await getSecret('OPENAI_API_KEY');
      this.client = new OpenAI({ apiKey });
      this.logger.info('OpenAI service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI service:', error);
      throw error;
    }
  }

  async mergeDescriptions(appraiserDescription, iaDescription) {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert at merging appraisal descriptions while maintaining accuracy and professionalism."
          },
          {
            role: "user",
            content: `Please merge these two appraisal descriptions into one cohesive, professional description:\n\nAppraiser's Description: ${appraiserDescription}\n\nIA Description: ${iaDescription}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      this.logger.error('Error merging descriptions:', error);
      throw error;
    }
  }
}

module.exports = new OpenAIService();