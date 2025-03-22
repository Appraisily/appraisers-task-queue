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
   * @param {string} postId - The WordPress post ID
   * @returns {Promise<void>}
   */
  async completeAppraisalReport(postId) {
    try {
      this.logger.info(`Triggering appraisal report generation for post ${postId}`);
      
      // This typically makes a request to the main appraisals backend
      // to trigger the report generation process
      const appraisalsBackendUrl = await secretManager.getSecret('APPRAISALS_BACKEND_URL');
      
      if (!appraisalsBackendUrl) {
        throw new Error('Missing APPRAISALS_BACKEND_URL in Secret Manager');
      }
      
      const response = await fetch(`${appraisalsBackendUrl}/appraisal/generate-report/${postId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authHeader
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Report generation failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      this.logger.info(`Successfully triggered report generation for post ${postId}`);
    } catch (error) {
      this.logger.error(`Error completing appraisal report for post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = WordPressService;