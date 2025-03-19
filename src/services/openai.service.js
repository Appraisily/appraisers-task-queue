const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

/**
 * Service for interacting with OpenAI API
 */
class OpenAIService {
  constructor() {
    this.logger = createLogger('OpenAIService');
    this.apiKey = null;
  }

  /**
   * Initialize the OpenAI service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing OpenAI service...');
      
      this.apiKey = await secretManager.getSecret('OPENAI_API_KEY');
      
      if (!this.apiKey) {
        throw new Error('Missing OpenAI API key in Secret Manager');
      }
      
      this.logger.info('OpenAI service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI service:', error);
      throw error;
    }
  }

  /**
   * Merge two descriptions using OpenAI
   * @param {string} appraisalDescription - Appraiser's description
   * @param {string} iaDescription - AI-generated description
   * @returns {Promise<string>} - Merged description
   */
  async mergeDescriptions(appraisalDescription, iaDescription) {
    try {
      this.logger.info('Merging descriptions with OpenAI');
      
      const fetch = require('node-fetch');
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a professional art appraiser. Your task is to combine two descriptions of an art piece into a single, cohesive description that is concise yet informative. The combined description should be no more than 200 words.'
            },
            {
              role: 'user',
              content: `Please merge these two descriptions into a single cohesive description of no more than 200 words:\n\nAppraiser's Description: ${appraisalDescription}\n\nAI-Generated Description: ${iaDescription}`
            }
          ],
          max_tokens: 500,
          temperature: 0.5
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const mergedDescription = result.choices[0].message.content.trim();
      
      this.logger.info('Successfully merged descriptions');
      
      return mergedDescription;
    } catch (error) {
      this.logger.error('Error merging descriptions:', error);
      throw error;
    }
  }
}

module.exports = OpenAIService;