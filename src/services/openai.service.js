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
   * @returns {Promise<Object>} - Object containing mergedDescription, briefTitle, detailedTitle, and metadata
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
              content: 'You are a professional art appraiser. Your task is to analyze art descriptions and extract structured metadata, combining information into cohesive descriptions and generating two title versions: 1) A brief title (maximum 60 characters) suitable for display, and 2) A detailed title/description (1-2 paragraphs) with comprehensive metadata about the artwork.'
            },
            {
              role: 'user',
              content: `Please analyze these two descriptions of an artwork:\n\nAppraiser's Description: ${appraisalDescription}\n\nAI-Generated Description: ${iaDescription}\n\nAnd provide the following structured outputs:\n1. BRIEF_TITLE: A concise title for the WordPress post (max 60 characters)\n2. DETAILED_TITLE: A comprehensive 1-2 paragraph description with rich metadata\n3. MERGED_DESCRIPTION: A cohesive summary description of about 200 words that combines both descriptions\n4. METADATA: Structured data about the artwork in this format:\n   - OBJECT_TYPE: (e.g., Painting, Sculpture, Print)\n   - CREATOR: The artist's name\n   - ESTIMATED_AGE: The period or approximate age\n   - MEDIUM: The materials used\n   - CONDITION_SUMMARY: Brief assessment of the condition`
            }
          ],
          max_tokens: 1200,
          temperature: 0.5
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const content = result.choices[0].message.content.trim();
      
      // Parse the response to extract the components
      const briefTitleMatch = content.match(/BRIEF_TITLE:(.*?)(?=DETAILED_TITLE:|$)/s);
      const detailedTitleMatch = content.match(/DETAILED_TITLE:(.*?)(?=MERGED_DESCRIPTION:|$)/s);
      const mergedDescriptionMatch = content.match(/MERGED_DESCRIPTION:(.*?)(?=METADATA:|$)/s);
      const metadataMatch = content.match(/METADATA:(.*?)$/s);
      
      const briefTitle = briefTitleMatch ? briefTitleMatch[1].trim() : 'Untitled Artwork';
      const detailedTitle = detailedTitleMatch ? detailedTitleMatch[1].trim() : '';
      const mergedDescription = mergedDescriptionMatch ? mergedDescriptionMatch[1].trim() : content;
      
      // Extract structured metadata
      const metadata = {};
      if (metadataMatch) {
        const metadataText = metadataMatch[1];
        
        const objectTypeMatch = metadataText.match(/OBJECT_TYPE:(.*?)(?=-|$)/s);
        const creatorMatch = metadataText.match(/CREATOR:(.*?)(?=-|$)/s);
        const estimatedAgeMatch = metadataText.match(/ESTIMATED_AGE:(.*?)(?=-|$)/s);
        const mediumMatch = metadataText.match(/MEDIUM:(.*?)(?=-|$)/s);
        const conditionMatch = metadataText.match(/CONDITION_SUMMARY:(.*?)(?=-|$)/s);
        
        if (objectTypeMatch) metadata.object_type = objectTypeMatch[1].trim();
        if (creatorMatch) metadata.creator = creatorMatch[1].trim();
        if (estimatedAgeMatch) metadata.estimated_age = estimatedAgeMatch[1].trim();
        if (mediumMatch) metadata.medium = mediumMatch[1].trim();
        if (conditionMatch) metadata.condition_summary = conditionMatch[1].trim();
      }
      
      this.logger.info('Successfully generated titles, merged description, and structured metadata');
      this.logger.info(`Metadata extracted: ${JSON.stringify(metadata)}`);
      
      return {
        mergedDescription,
        briefTitle,
        detailedTitle,
        metadata
      };
    } catch (error) {
      this.logger.error('Error generating titles and merged description:', error);
      throw error;
    }
  }
}

module.exports = OpenAIService;