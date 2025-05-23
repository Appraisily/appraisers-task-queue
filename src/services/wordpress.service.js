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
        age_text,
        pdfLink,
        docLink
      } = updateData;
      
      // Prepare the update payload
      const payload = {};
      
      // Only add fields that are provided
      if (title) payload.title = title;
      
      // Special handling for content with block references
      if (content) {
        // Check if content contains only a block reference
        if (content.trim().startsWith('<!-- wp:block {"ref":') && 
            content.trim().endsWith('/-->') && 
            !content.includes('<div')) {
          // This is a clean block reference - keep it as is
          payload.content = content;
          this.logger.info(`Updating post ${postId} with clean block reference`);
        } else if (content.includes('<!-- wp:block {"ref":')) {
          // Content contains a block reference mixed with rendered content
          // Extract just the block reference to prevent duplication
          const blockRefMatch = content.match(/<!-- wp:block {"ref":[0-9]+} \/-->/);
          if (blockRefMatch && blockRefMatch[0]) {
            payload.content = blockRefMatch[0];
            this.logger.info(`Extracted block reference from mixed content for post ${postId}`);
          } else {
            payload.content = content;
          }
        } else {
          // Regular content without block references
          payload.content = content;
        }
      }

      // Prepare ACF fields update if any ACF fields are provided
      const acfData = {};
      
      // Only add ACF fields if they're provided
      if (value !== undefined) acfData.value = value ? Number(value) : null;
      if (appraisalType) acfData.appraisaltype = appraisalType || 'Regular';
      if (detailedTitle) acfData.detailedtitle = detailedTitle;
      if (object_type) acfData.object_type = object_type;
      if (creator) acfData.creator = creator;
      if (estimated_age) acfData.estimated_age = estimated_age;
      if (age_text) acfData.age_text = age_text;
      if (medium) acfData.medium = medium;
      if (condition_summary) acfData.condition_summary = condition_summary;
      if (condition) acfData.condition = condition;
      
      // Map PDF and HTML links to their respective ACF fields if provided
      if (pdfLink) acfData.pdflink = pdfLink;
      if (docLink) acfData.doclink = docLink;
      
      // Only add the acf field to payload if we have ACF data
      if (Object.keys(acfData).length > 0) {
        payload.acf = acfData;
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
      
      const requestBody = JSON.stringify(payload);
      
      this.logger.info(`Updating WordPress post ${postId}`);

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