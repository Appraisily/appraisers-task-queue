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
   * Get the permalink (public URL) for a WordPress post
   * @param {string} postId - The WordPress post ID
   * @returns {Promise<string>} - The permalink URL
   */
  async getPermalink(postId) {
    try {
      this.logger.info(`Getting permalink for post ${postId}`);
      const postData = await this.getPost(postId);
      
      if (!postData || !postData.link) {
        throw new Error(`No permalink found for post ${postId}`);
      }
      
      return postData.link;
    } catch (error) {
      this.logger.error(`Error getting permalink for post ${postId}:`, error);
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
      const { 
        title, 
        content, 
        value, 
        appraisalType, 
        detailedTitle, 
        status_progress, 
        status_details, 
        status_timestamp,
        object_type,
        creator,
        estimated_age,
        medium,
        condition_summary,
        condition,
        age_text
      } = updateData;
      
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

      // Add detailed title to ACF if provided
      if (detailedTitle) {
        acfData.detailed_title = detailedTitle;
        this.logger.info(`Adding detailed title to post ${postId}`);
      }

      // Add metadata fields if provided
      if (object_type) acfData.object_type = object_type;
      if (creator) acfData.creator = creator;
      if (estimated_age) acfData.estimated_age = estimated_age;
      if (age_text) acfData.age_text = age_text;
      if (medium) acfData.medium = medium;
      if (condition_summary) acfData.condition_summary = condition_summary;
      if (condition) acfData.condition = condition;

      // Add status updates if provided
      if (status_progress) acfData.status_progress = status_progress;
      if (status_details) acfData.status_details = status_details;
      if (status_timestamp) acfData.status_timestamp = status_timestamp;

      // Log the ACF fields being updated
      this.logger.info(`Updating WordPress post ${postId} with ACF fields: ${Object.keys(acfData).join(', ')}`);

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