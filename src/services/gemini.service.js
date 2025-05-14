const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');
const { GoogleGenerativeAI } = require('@google/genai');

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
        You are an expert art and antiques appraiser tasked with analyzing WordPress post data to extract structured information for an appraisal process.
        
        Here is the extracted data from a WordPress post:
        
        Title: ${appraisalData.title}
        Content: ${appraisalData.content.substring(0, 2000)}${appraisalData.content.length > 2000 ? '... (content truncated)' : ''}
        Appraisal Type: ${appraisalData.appraisalType || 'Not specified'}
        Current Value: ${appraisalData.appraisalValue || 'Not specified'}
        
        Image URLs: ${JSON.stringify(appraisalData.imageUrls.map(img => img.url).slice(0, 5))}
        
        Metadata fields: ${Object.keys(appraisalData.metadata).join(', ')}
        
        Your task is to extract and organize all relevant information needed to begin processing this appraisal. 
        
        Please analyze the data and provide:
        
        1. A comprehensive description of the item being appraised, combining all available information.
        2. A clear appraisal value (in USD) if you can determine it from the content.
        3. The type/category of the item (painting, sculpture, jewelry, etc.).
        4. Creator/artist name if available.
        5. Age or period of creation.
        6. Materials and techniques used.
        7. Condition assessment.
        8. Size/dimensions if available.
        
        Return your analysis as a structured JSON with the following fields:
        {
          "title": "Brief, accurate title for the item (max 10 words)",
          "detailedTitle": "More descriptive title with key details",
          "objectType": "Category of object",
          "creator": "Artist or creator",
          "age": "Estimated age or period",
          "materials": "Materials used",
          "dimensions": "Size information if available",
          "condition": "Condition assessment",
          "recommendedValue": "Your professional assessment of value in USD (numbers only, no currency symbol)",
          "mergedDescription": "Comprehensive description combining all relevant details"
        }
      `;
      
      const result = await this.model.generateContent(prompt);
      const responseText = result.text();
      
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
          title: appraisalData.title || 'Artwork Appraisal',
          detailedTitle: appraisalData.title || 'Artwork Appraisal - Processing Error',
          objectType: 'Unknown',
          creator: 'Unknown',
          age: 'Unknown',
          materials: 'Unknown',
          dimensions: 'Unknown',
          condition: 'Unknown',
          recommendedValue: appraisalData.appraisalValue || '',
          mergedDescription: appraisalData.content || 'Error processing appraisal data. Please contact support.'
        };
      }
      
      // Ensure the response has all expected fields
      const defaultResponse = {
        title: appraisalData.title || 'Artwork Appraisal',
        detailedTitle: appraisalData.title || 'Artwork Appraisal',
        objectType: 'Unknown',
        creator: 'Unknown',
        age: 'Unknown',
        materials: 'Unknown',
        dimensions: 'Unknown',
        condition: 'Unknown',
        recommendedValue: appraisalData.appraisalValue || '',
        mergedDescription: appraisalData.content || ''
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