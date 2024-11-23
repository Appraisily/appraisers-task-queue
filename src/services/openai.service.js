const OpenAI = require('openai');
const { createLogger } = require('../utils/logger');

class OpenAIService {
  constructor() {
    this.logger = createLogger('OpenAIService');
    this.client = null;
    this.initialized = false;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      if (!config.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not found');
      }

      this.client = new OpenAI({ 
        apiKey: config.OPENAI_API_KEY 
      });

      // Test the connection
      await this.client.models.list();

      this.initialized = true;
      this.logger.info('OpenAI service initialized');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize OpenAI service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async mergeDescriptions(appraiserDescription, iaDescription) {
    if (!this.initialized) {
      throw new Error('OpenAI service not initialized');
    }

    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert art appraiser tasked with merging two artwork descriptions into a single, comprehensive description."
          },
          {
            role: "user",
            content: `Please merge these two artwork descriptions into a single, well-organized description:

Appraiser's Description:
${appraiserDescription}

AI-Generated Description:
${iaDescription}

The merged description should:
1. Combine unique details from both descriptions
2. Eliminate redundancy
3. Maintain a professional tone
4. Be organized and easy to read`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      this.logger.error('Error merging descriptions:', error);
      throw error;
    }
  }
}

module.exports = OpenAIService;