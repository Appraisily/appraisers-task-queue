const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

/**
 * Service for converting appraisal data to formatted markdown using Gemini 2.5 Pro
 */
class GeminiDocsService {
  constructor(googleDocsService) {
    this.logger = createLogger('GeminiDocsService');
    this.client = null;
    this.model = null;
    this.initialized = false;
    this.templatePath = path.join(__dirname, '../templates/appraisal/master-template.md');
    this.googleDocsService = googleDocsService;
  }

  /**
   * Initialize the Gemini Docs service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing Gemini Docs service...');
      
      const apiKey = await secretManager.getSecret('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('Gemini API key not found in Secret Manager');
      }
      
      this.client = new GoogleGenerativeAI(apiKey);
      this.model = this.client.getGenerativeModel({ model: "gemini-2.5-pro-preview-05-06" });
      
      this.initialized = true;
      this.logger.info('Gemini Docs service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Gemini Docs service:', error);
      throw error;
    }
  }

  /**
   * Check if the service is initialized
   * @returns {boolean} - Whether the service is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Get the master template content
   * @returns {Promise<string>} - The template content
   */
  async getTemplate() {
    try {
      return await fs.promises.readFile(this.templatePath, 'utf8');
    } catch (error) {
      this.logger.error('Error reading template file:', error);
      throw error;
    }
  }

  /**
   * Create a formatted prompt for Gemini
   * @param {string} template - The template content
   * @param {Object} data - The appraisal data
   * @returns {string} - The formatted prompt
   */
  createPrompt(template, data) {
    return `
You are a document formatter. Your task is to fill the provided template with the appraisal data.
DO NOT modify, change, or add to the appraisal content - only format it according to the template.

TEMPLATE:
${template}

APPRAISAL DATA:
${JSON.stringify(data, null, 2)}

FORMAT INSTRUCTIONS:
1. Replace each placeholder (e.g. {{placeholder_name}}) with its corresponding value from the data
2. Maintain all markdown formatting in the template
3. If a placeholder has no corresponding data, leave it empty (do not remove it)
4. Do not add any commentary or additional content
5. Return ONLY the filled template with no additional text before or after
`;
  }

  /**
   * Generate a document from WordPress post using Gemini
   * @param {string} postId - The WordPress post ID
   * @param {Object} wordpressService - The WordPress service instance
   * @param {Object} options - Options for conversion
   * @returns {Promise<Object>} - The result with docUrl and optional fileContent
   */
  async generateDocFromWordPressPost(postId, wordpressService, options = {}) {
    if (!this.isInitialized()) {
      await this.initialize();
    }

    try {
      this.logger.info(`Generating Gemini-powered document for WordPress post ${postId}`);
      
      // Get WordPress data with all metadata
      const postData = await wordpressService.getPostWithMetadata(postId);
      
      // Get the master template
      const template = await this.getTemplate();
      
      // Create the prompt for Gemini
      const prompt = this.createPrompt(template, postData);
      
      // Call Gemini to fill the template
      this.logger.info('Calling Gemini to fill template with appraisal data');
      const result = await this.model.generateContent(prompt);
      const filledMarkdown = result.response.text();
      
      // Use the Google Docs service to convert the filled markdown to a Google Doc
      const docResult = await this.googleDocsService.markdownToGoogleDoc(filledMarkdown, {
        filename: `Gemini-Appraisal-${postId}-${Date.now()}`,
        ...options
      });
      
      this.logger.info(`Gemini document generated successfully for post ${postId}`);
      return docResult;
    } catch (error) {
      this.logger.error(`Error generating Gemini document for post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = GeminiDocsService; 