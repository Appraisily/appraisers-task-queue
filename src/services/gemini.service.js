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
      this.model = this.client.getGenerativeModel({ model: "gemini-2.5-pro-preview-05-06" });
      
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
   * @param {object} wordpressPostData - Raw WordPress post data (no preprocessing)
   * @returns {Promise<object>} - Structured appraisal data
   */
  async processAppraisalData(wordpressPostData) {
    if (!this.isInitialized()) {
      throw new Error('Gemini service not initialized');
    }
    try {
      this.logger.info('Calling Gemini to process raw WordPress post data');
      const prompt = `
        You are an expert art and antiques appraiser. You will receive the complete, raw WordPress post data for an appraisal request. Do not expect any preprocessing or field extraction; all data is provided as-is, directly from WordPress. Your job is to analyze this raw data and extract ONLY the following fields:
        
        1. title (brief, max 10 words)
        2. value (appraisal value in USD, numbers only, no currency symbol)
        3. imageURLs (array, up to 3 images, select in this order of priority: ACF main image, ACF age image, ACF signature image, or the featured image of the post)
        4. sessionID (from the data)
        5. customerEmail (from the data)
        6. detailedTitle (more descriptive title with key details)
        
        Here is the complete, raw WordPress post data (as a JSON object):
        
        ${JSON.stringify(wordpressPostData, null, 2)}
        
        Your task is to extract and organize ONLY the above 6 fields. For imageURLs, select up to 3 images in this order: ACF main image, ACF age image, ACF signature image, or the featured image. If not available, leave empty. Return your analysis as a structured JSON with ONLY these fields:
        {
          "title": "Brief, accurate title for the item (max 10 words)",
          "value": "Appraisal value in USD (numbers only, no currency symbol)",
          "imageURLs": ["url1", "url2", "url3"],
          "sessionID": "Session ID",
          "customerEmail": "Customer email",
          "detailedTitle": "More descriptive title with key details"
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
          title: '',
          value: '',
          imageURLs: [],
          sessionID: '',
          customerEmail: '',
          detailedTitle: ''
        };
      }
      // Ensure the response has all expected fields
      const defaultResponse = {
        title: '',
        value: '',
        imageURLs: [],
        sessionID: '',
        customerEmail: '',
        detailedTitle: ''
      };
      // Merge the parsed response with defaults for any missing fields
      return { ...defaultResponse, ...parsedResponse };
    } catch (error) {
      this.logger.error('Error calling Gemini API:', error);
      throw error;
    }
  }
}

module.exports = GeminiService; 