const { OpenAI } = require('openai');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class OpenAIService {
  constructor() {
    this.logger = createLogger('OpenAI');
    this.client = null;
  }

  async initialize() {
    const apiKey = await secretManager.getSecret('OPENAI_API_KEY');
    this.client = new OpenAI({ apiKey });
  }

  async mergeDescriptions(appraiserDescription, iaDescription) {
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
  }
}

module.exports = new OpenAIService();