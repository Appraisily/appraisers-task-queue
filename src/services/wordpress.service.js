const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPressService');
    this.initialized = false;
    this.baseUrl = null;
    this.auth = null;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing WordPress service...');

      if (!config.WORDPRESS_API_URL) {
        throw new Error('WordPress API URL not configured');
      }
      if (!config.WP_USERNAME) {
        throw new Error('WordPress username not configured');
      }
      if (!config.WP_APP_PASSWORD) {
        throw new Error('WordPress app password not configured');
      }

      this.baseUrl = config.WORDPRESS_API_URL.replace(/\/$/, '');
      this.auth = Buffer.from(`${config.WP_USERNAME}:${config.WP_APP_PASSWORD}`).toString('base64');

      // Test the connection
      const response = await fetch(`${this.baseUrl}/wp/v2/posts?per_page=1`, {
        headers: {
          'Authorization': `Basic ${this.auth}`,
        },
      });

      if (!response.ok) {
        throw new Error(`WordPress API test failed: ${response.statusText}`);
      }

      this.initialized = true;
      this.logger.info('WordPress service initialized successfully');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize WordPress service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async getPost(postId) {
    if (!this.initialized) {
      throw new Error('WordPress service not initialized');
    }

    try {
      const response = await fetch(`${this.baseUrl}/wp/v2/posts/${postId}`, {
        headers: {
          'Authorization': `Basic ${this.auth}`,
        },
      });

      if (!response.ok) {
        throw new Error(`WordPress API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Error getting post ${postId}:`, error);
      throw error;
    }
  }

  async updatePost(postId, data) {
    if (!this.initialized) {
      throw new Error('WordPress service not initialized');
    }

    try {
      const response = await fetch(`${this.baseUrl}/wp/v2/posts/${postId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WordPress API error: ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Error updating post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = WordPressService;