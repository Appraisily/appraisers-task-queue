const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Service for interacting with Google's Gemini 2.5 Pro API
 */
class GeminiService {
  constructor() {
    this.logger = createLogger('GeminiService');
    this.client = null;
    this.initialized = false;
  }

  /**
   * Initialize the Gemini service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing Gemini service...');
      
      const apiKey = await secretManager.getSecret('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('Gemini API key not found in Secret Manager');
      }
      
      this.client = new GoogleGenerativeAI(apiKey);
      this.model = this.client.getGenerativeModel({ model: "gemini-2.5-pro" });
      
      this.initialized = true;
      this.logger.info('Gemini service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Gemini service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  /**
   * Process appraisal data with Gemini 2.5 Pro
   * @param {object} appraisalData - Extracted appraisal data
   * @returns {Promise<object>} - Structured appraisal data
   */
  async processAppraisalData(appraisalData) {
    if (!this.isInitialized()) {
      throw new Error('Gemini service not initialized');
    }
    
    try {
      this.logger.info('Calling Gemini to process appraisal data');
      
      const prompt = `
        You are an expert art and antiques appraiser. You are analyzing data extracted from an existing appraisal to migrate it to a new format.
        
        Here is the extracted data:
        
        ${JSON.stringify(appraisalData, null, 2)}
        
        Please analyze this data and create a structured response that includes:
        
        1. A comprehensive merged description that combines all relevant elements from all descriptions.
           This should be extremely detailed to ensure all available information is included.
           Include all relevant details about style, period, materials, condition, artist background, provenance,
           artistic significance, historical context, craftsmanship, dimensions, color palette, composition, 
           and any other significant attributes. Do not omit any information.
        
        2. A brief title (up to 10 words) that clearly identifies the item with its key features.
        
        3. Structure all metadata into clear categories.
        
        Return your response in JSON format with these fields: 
        {
          "title": "Brief title of the item",
          "detailedTitle": "Longer, more descriptive title",
          "objectType": "Type of object (painting, sculpture, etc.)",
          "creator": "Artist or creator name",
          "age": "Estimated age or period",
          "materials": "Materials used",
          "dimensions": "Size information",
          "condition": "Condition assessment",
          "provenance": "History of ownership if available",
          "mergedDescription": "Comprehensive description combining all sources"
        }
      `;
      
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      
      // Parse the JSON response
      let parsedResponse;
      try {
        // Extract JSON if it's wrapped in markdown code blocks
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                           responseText.match(/```\n([\s\S]*?)\n```/) ||
                           [null, responseText];
        
        const jsonContent = jsonMatch[1] || responseText;
        parsedResponse = JSON.parse(jsonContent);
      } catch (parseError) {
        this.logger.error('Failed to parse Gemini JSON response', parseError);
        
        // Return a basic format to prevent complete failure
        return {
          title: 'Artwork Appraisal',
          detailedTitle: 'Artwork Appraisal - Migration Error',
          objectType: 'Unknown',
          creator: 'Unknown',
          age: 'Unknown',
          materials: 'Unknown',
          dimensions: 'Unknown',
          condition: 'Unknown',
          provenance: 'Unknown',
          mergedDescription: 'Error processing appraisal data. Please contact support.'
        };
      }
      
      return parsedResponse;
    } catch (error) {
      this.logger.error('Error calling Gemini API:', error);
      throw error;
    }
  }
}

module.exports = GeminiService; 