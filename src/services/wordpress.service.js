const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

/**
 * Service for interacting with WordPress API
 */
class WordPressService {
  constructor() {
    this.logger = createLogger('WordPressService');
    this.apiUrl = null;
    this.authHeader = null;
  }

  /**
   * Initialize the WordPress service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing WordPress service...');
      
      // Get WordPress credentials from Secret Manager
      const [apiUrl, username, appPassword] = await Promise.all([
        secretManager.getSecret('WORDPRESS_API_URL'),
        secretManager.getSecret('wp_username'),
        secretManager.getSecret('wp_app_password')
      ]);

      if (!apiUrl || !username || !appPassword) {
        throw new Error('Missing WordPress credentials in Secret Manager');
      }

      this.apiUrl = apiUrl;
      
      // Create the Basic Auth header
      const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
      this.authHeader = `Basic ${credentials}`;
      
      this.logger.info('WordPress service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize WordPress service:', error);
      throw error;
    }
  }

  /**
   * Get a WordPress post by ID
   * @param {string} postId - The WordPress post ID
   * @returns {Promise<Object>} - The post data
   */
  async getPost(postId) {
    try {
      const response = await fetch(`${this.apiUrl}/appraisals/${postId}`, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Error getting WordPress post ${postId}:`, error);
      throw error;
    }
  }

  /**
   * Update a WordPress post with appraisal data
   * @param {string} postId - The WordPress post ID
   * @param {Object} updateData - The data to update
   * @returns {Promise<Object>} - The updated post data with publicUrl
   */
  async updateAppraisalPost(postId, updateData) {
    try {
      const { title, content, value, appraisalType } = updateData;
      
      // Prepare the update payload
      const payload = {
        title,
        content
      };

      // Prepare ACF fields update
      const acfData = {
        value: value,
        appraisaltype: appraisalType || 'Regular',
        shortcodes_inserted: true
      };

      // Update the post
      const response = await fetch(`${this.apiUrl}/appraisals/${postId}`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...payload,
          acf: acfData
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WordPress API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const updatedPost = await response.json();
      
      // Get public URL
      const publicUrl = updatedPost.link;
      
      return {
        ...updatedPost,
        publicUrl
      };
    } catch (error) {
      this.logger.error(`Error updating WordPress post ${postId}:`, error);
      throw error;
    }
  }
  
  /**
   * Trigger the appraisal report generation process
   * This is a two-step process:
   * 1. Complete the appraisal processing 
   * 2. Generate the PDF document
   * @param {string} postId - The WordPress post ID
   * @returns {Promise<void>}
   */
  async completeAppraisalReport(postId) {
    try {
      this.logger.info(`Starting appraisal completion process for post ${postId}`);
      
      // Get backend URL directly from environment variable
      let appraisalsBackendUrl = process.env.APPRAISALS_BACKEND_URL;
      
      // Use default fallback if not set in environment
      if (!appraisalsBackendUrl) {
        appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
        this.logger.warn(`Using default fallback URL for appraisals backend: ${appraisalsBackendUrl}`);
      } else {
        this.logger.info(`Using APPRAISALS_BACKEND_URL from environment variable: ${appraisalsBackendUrl}`);
      }
      
      // STEP 1: Complete the appraisal processing
      this.logger.info(`STEP 1: Completing appraisal processing for post ${postId}`);
      try {
        const completeResponse = await fetch(`${appraisalsBackendUrl}/complete-appraisal-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.authHeader
          },
          body: JSON.stringify({ postId: postId.toString() })
        });
        
        if (!completeResponse.ok) {
          const errorText = await completeResponse.text();
          this.logger.warn(`Appraisal completion step failed: ${completeResponse.status} ${completeResponse.statusText} - ${errorText}`);
        } else {
          this.logger.info(`Successfully completed appraisal for post ${postId}`);
        }
      } catch (firstError) {
        this.logger.warn(`Error completing appraisal: ${firstError.message}`);
      }
      
      // STEP 2: Generate the PDF document
      this.logger.info(`STEP 2: Generating PDF for post ${postId}`);
      try {
        const pdfResponse = await fetch(`${appraisalsBackendUrl}/generate-pdf`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.authHeader
          },
          body: JSON.stringify({ postId: postId.toString() })
        });
        
        if (!pdfResponse.ok) {
          const errorText = await pdfResponse.text();
          this.logger.warn(`PDF generation step failed: ${pdfResponse.status} ${pdfResponse.statusText} - ${errorText}`);
        } else {
          this.logger.info(`Successfully generated PDF for post ${postId}`);
        }
      } catch (secondError) {
        this.logger.warn(`Error generating PDF: ${secondError.message}`);
      }
      
      this.logger.info(`Appraisal report processing completed for post ${postId}`);
    } catch (error) {
      this.logger.error(`Error during appraisal report workflow for post ${postId}:`, error);
      // Treat this as a non-fatal error - log it but don't throw
      // We've already updated WordPress with the content at this point
      this.logger.warn(
        `Some appraisal report steps failed for post ${postId}, but the post was updated successfully. ` +
        `You may need to manually complete the process.`
      );
    }
  }
}

module.exports = WordPressService;