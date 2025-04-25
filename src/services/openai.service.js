const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');
const OpenAI = require('openai');
const fetch = require('node-fetch');

/**
 * Service for interacting with OpenAI API
 */
class OpenAIService {
  constructor() {
    this.logger = createLogger('OpenAIService');
    this.client = null;
    this.initialized = false;
  }

  /**
   * Initialize the OpenAI service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing OpenAI service...');
      
      const apiKey = await secretManager.getSecret('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OpenAI API key not found in Secret Manager');
      }
      
      this.client = new OpenAI({
        apiKey: apiKey
      });
      
      this.initialized = true;
      this.logger.info('OpenAI service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  /**
   * Merge customer description with AI-generated description
   * @param {string} customerDescription - User-provided description
   * @param {string} iaDescription - AI-generated description (from image analysis)
   * @returns {Promise<object>} - Merged description, titles, and metadata
   */
  async mergeDescriptions(customerDescription, iaDescription) {
    if (!this.isInitialized()) {
      throw new Error('OpenAI service not initialized');
    }
    
    try {
      this.logger.info('Merging descriptions...');
      
      const prompt = `
        You are an expert art and antiques appraiser. Your task is to merge two descriptions of an item:
        
        1. Customer Description: "${customerDescription}"
        
        2. Expert Analysis (from image): "${iaDescription}"
        
        Please create:
        
        1. A comprehensive merged description that combines ALL the factual elements from both inputs.
          This should be detailed and can be quite lengthy to ensure all important information is included.
          If there are contradictions between the descriptions, prioritize the Expert Analysis information.
          Include ALL relevant details about style, period, materials, condition, artist background, and other significant attributes.
        
        2. A brief title (max 60 chars) that clearly identifies the item.
        
        3. Metadata in JSON format with these fields:
           - object_type: The type of object being described
           - creator: Artist or creator name (if known)
           - estimated_age: Approximate creation date or period
           - medium: Materials used in creation
           - condition_summary: Brief assessment of condition
        
        Return your response in JSON format with these fields: 
        mergedDescription, briefTitle, metadata.
      `;
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert art appraiser assistant that creates comprehensive appraisal descriptions. Include all relevant details and prioritize expert analysis over customer descriptions when there are contradictions. Be thorough and detailed in your merged descriptions.'
          },
          { 
            role: 'user', 
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 2500
      });
      
      // Get the response text
      const responseText = response.choices[0].message.content;
      
      // Parse the JSON response
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        this.logger.error('Failed to parse OpenAI JSON response:', parseError);
        this.logger.error('Raw response:', responseText);
        
        // Return a basic format to prevent complete failure
        return {
          mergedDescription: 'Error merging descriptions. Please contact support.',
          briefTitle: 'Artwork Appraisal',
          detailedTitle: 'Art Appraisal Report',
          metadata: {}
        };
      }
      
      // Validate the presence of all expected fields
      const { mergedDescription, briefTitle, metadata } = parsedResponse;
      
      if (!mergedDescription) {
        throw new Error('Missing mergedDescription in OpenAI response');
      }
      
      return {
        mergedDescription: mergedDescription || 'Error generating description.',
        briefTitle: briefTitle || 'Artwork Appraisal',
        // For backward compatibility, use the merged description as detailed title
        detailedTitle: mergedDescription || 'Art Appraisal Report',
        metadata: metadata || {}
      };
    } catch (error) {
      this.logger.error('Error merging descriptions:', error);
      throw error;
    }
  }

  /**
   * Analyze an image using GPT-4o and return a description
   * @param {string} imageUrl - URL of the image to analyze
   * @param {string} prompt - Prompt for GPT-4o to analyze the image
   * @returns {Promise<string>} - Description of the image
   */
  async analyzeImageWithGPT4o(imageUrl, prompt) {
    if (!this.isInitialized()) {
      throw new Error('OpenAI service not initialized');
    }
    
    try {
      this.logger.info(`Analyzing image with GPT-4o: ${imageUrl}`);
      
      // First, fetch the image and encode as base64
      let imageData;
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        
        const imageBuffer = await response.buffer();
        imageData = imageBuffer.toString('base64');
      } catch (fetchError) {
        this.logger.error('Error fetching image:', fetchError);
        throw new Error(`Failed to fetch image: ${fetchError.message}`);
      }
      
      // Call GPT-4o with the image
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert art and antiquity appraiser with extensive knowledge of art history, styles, periods, materials, and valuation techniques.'
          },
          { 
            role: 'user', 
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageData}`
                }
              }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 1500
      });
      
      // Get the response text
      const description = response.choices[0].message.content;
      
      this.logger.info(`GPT-4o analysis complete, generated ${description.length} characters`);
      
      return description;
    } catch (error) {
      this.logger.error('Error analyzing image with GPT-4o:', error);
      throw error;
    }
  }
}

module.exports = OpenAIService;