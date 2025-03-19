const { OpenAI } = require('openai');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');
const OPENAI_SECRET_NAME = 'OPENAI_API_KEY';

class OpenAIService {
  constructor() {
    this.logger = createLogger('OpenAI');
    this.client = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing OpenAI service...');
      const apiKey = await secretManager.getSecret(OPENAI_SECRET_NAME);
      
      if (!apiKey) {
        throw new Error(`Failed to retrieve ${OPENAI_SECRET_NAME} from Secret Manager`);
      }

      this.client = new OpenAI({ apiKey });
      this.initialized = true;
      this.logger.info('OpenAI service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI service:', error);
      throw error;
    }
  }

  async mergeDescriptions(appraiserDescription, iaDescription) {
    if (!this.initialized || !this.client) {
      throw new Error('OpenAI service not initialized');
    }

    const response = await this.client.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert art appraiser tasked with merging two artwork descriptions into a single, concise description. Keep the merged description under 200 words and focus on the most important details."
        },
        {
          role: "user",
          content: `Please merge these two artwork descriptions into a single, concise description:

Appraiser's Description:
${appraiserDescription}

AI-Generated Description:
${iaDescription}

The merged description should:
1. Combine unique details from both descriptions
2. Eliminate redundancy
3. Maintain a professional tone
4. Be organized and easy to read
5. Stay under 200 words`
        }
      ],
      temperature: 0.7,
      max_tokens: 400 // This ensures we get a complete but concise description
    });

    return response.choices[0].message.content.trim();
  }
}

module.exports = OpenAIService;