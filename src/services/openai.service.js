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
   * @param {string} customerDescription - User-provided description (from the appraiser - most important)
   * @param {string} iaDescription - AI-generated description (from image analysis)
   * @returns {Promise<object>} - Merged description, titles, and metadata
   */
  async mergeDescriptions(customerDescription, iaDescription) {
    if (!this.isInitialized()) {
      throw new Error('OpenAI service not initialized');
    }
    
    try {
      // Only log that we're making the API call, no data details
      this.logger.info('Calling OpenAI to merge descriptions');
      
      const prompt = `
        You are an expert art and antiques appraiser. Your task is to merge two descriptions of an item:
        
        1. Appraiser's Description (MOST IMPORTANT): "${customerDescription}"
        
        2. AI Image Analysis: "${iaDescription}"
        
        Please create:
        
        1. A comprehensive merged description that combines all relevant elements from both inputs.
           This should be detailed to ensure all important information is included.
           THE APPRAISER'S DESCRIPTION IS AUTHORITATIVE. In case of ANY contradictions between descriptions, 
           ALWAYS prioritize the Appraiser's Description information.
           Include all relevant details about style, period, materials, condition, artist background, and other significant attributes.
        
        2. A brief title (max 60 chars) that clearly identifies the item.
        
        Return your response in JSON format with these fields: 
        mergedDescription, briefTitle.
      `;
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert art appraiser assistant that creates comprehensive appraisal descriptions. Always prioritize the appraiser\'s description over AI analysis when there are any contradictions. The appraiser\'s input is authoritative and should be considered the most reliable source of information.'
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
        this.logger.error('Failed to parse OpenAI JSON response');
        
        // Return a basic format to prevent complete failure
        return {
          mergedDescription: 'Error merging descriptions. Please contact support.',
          briefTitle: 'Artwork Appraisal'
        };
      }
      
      // Just return the parsed response - let AppraisalService handle the rest
      return parsedResponse;
    } catch (error) {
      this.logger.error('Error calling OpenAI API:', error);
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