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
        value: value ? Number(value) : null,
        appraisaltype: appraisalType || 'Regular',
        shortcodes_inserted: true
      };

      // Add detailed title to ACF if provided
      if (detailedTitle) {
        acfData.detailedtitle = detailedTitle;
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

      // DEBUG: Log detailed info about the ACF fields
      this.logger.info(`======= DETAILED ACF UPDATE DEBUG (POST ${postId}) =======`);
      for (const [field, fieldValue] of Object.entries(acfData)) {
        const valueType = typeof fieldValue;
        const valuePreview = valueType === 'string' 
          ? `"${fieldValue.substring(0, 50)}${fieldValue.length > 50 ? '...' : ''}"`
          : String(fieldValue);
        
        this.logger.info(`ACF Field "${field}": [${valueType}] ${valuePreview}`);
      }
      
      // Check for potential issues with detailedTitle
      if (detailedTitle) {
        if (detailedTitle.length > 100000) {
          this.logger.warn(`detailedTitle is extremely long (${detailedTitle.length} chars) - may exceed WordPress limits`);
        }
        if (detailedTitle.includes('\u0000')) {
          this.logger.warn(`detailedTitle contains null bytes which could cause saving issues`);
        }
      }
      
      const requestBody = JSON.stringify({
        ...payload,
        acf: acfData
      });
      
      this.logger.info(`Request payload length: ${requestBody.length} bytes`);
      
      // Log the ACF fields being updated
      this.logger.info(`Updating WordPress post ${postId} with ACF fields: ${Object.keys(acfData).join(', ')}`);

      // Update the post
      const response = await fetch(`${this.apiUrl}/appraisals/${postId}`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json'
        },
        body: requestBody
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`WordPress API Error Details for post ${postId}:`);
        this.logger.error(`Status: ${response.status} ${response.statusText}`);
        this.logger.error(`Response: ${errorText}`);
        throw new Error(`WordPress API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const updatedPost = await response.json();
      
      // DEBUG: Check the response to see if ACF fields were updated
      if (updatedPost.acf) {
        this.logger.info(`Response ACF fields for post ${postId}: ${Object.keys(updatedPost.acf).join(', ')}`);
        
        // Check if detailedtitle was saved correctly
        if (detailedTitle && updatedPost.acf.detailedtitle) {
          const responseDetailedTitle = updatedPost.acf.detailedtitle;
          const detailedTitleLength = responseDetailedTitle.length;
          const isTruncated = detailedTitleLength < detailedTitle.length;
          
          this.logger.info(`detailedtitle in response: ${detailedTitleLength} chars${isTruncated ? ' (TRUNCATED)' : ''}`);
        } else if (detailedTitle && !updatedPost.acf.detailedtitle) {
          this.logger.warn(`detailedtitle was sent but is missing from WordPress response!`);
        }
      } else {
        this.logger.warn(`No ACF data in WordPress response for post ${postId}`);
      }
      
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
      
      // Use runtime environment variable instead of Secret Manager
      // This is implemented as a runtime variable in Cloud Run
      let appraisalsBackendUrl = process.env.APPRAISALS_BACKEND_URL;
      
      // Fallback value if the runtime variable is not set
      if (!appraisalsBackendUrl) {
        this.logger.warn('APPRAISALS_BACKEND_URL runtime variable not found, using fallback URL');
        appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
      }
      
      const response = await fetch(`${appraisalsBackendUrl}/complete-appraisal-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authHeader
        },
        body: JSON.stringify({ postId: postId })
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

  /**
   * Get a media attachment by ID
   * @param {string|number} mediaId - The WordPress media ID
   * @returns {Promise<Object>} - The media data (including source_url)
   */
  async getMedia(mediaId) {
    try {
      // Use the correct WordPress REST API endpoint for media
      const mediaUrl = `https://resources.appraisily.com/wp-json/wp/v2/media/${mediaId}`;
      
      this.logger.info(`Fetching media data for ID ${mediaId} from ${mediaUrl}`);
      
      const response = await fetch(mediaUrl, {
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
      this.logger.error(`Error getting media with ID ${mediaId}:`, error);
      throw error;
    }
  }

  /**
   * Get the image URL from a field value (which may be an ID, object, or URL)
   * @param {string|number|object} imageField - The field value
   * @returns {Promise<string|null>} - The image URL or null if not found
   */
  async getImageUrl(imageField) {
    if (!imageField) return null;

    try {
      // If it's already a URL, return it
      if (typeof imageField === 'string' && imageField.startsWith('http')) {
        return imageField;
      }
      
      // If it's an object with a URL property, return that
      if (typeof imageField === 'object' && imageField.url) {
        return imageField.url;
      }

      // If it's a numeric ID (either number or string containing a number), fetch the media
      if (typeof imageField === 'number' || (typeof imageField === 'string' && /^\d+$/.test(imageField))) {
        const mediaData = await this.getMedia(imageField);
        return mediaData?.source_url || null;
      }

      return null;
    } catch (error) {
      this.logger.error(`Error getting image URL:`, error);
      return null;
    }
  }
}

module.exports = WordPressService;