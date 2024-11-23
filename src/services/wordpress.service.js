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
      if (!config.WORDPRESS_API_URL || !config.wp_username || !config.wp_app_password) {
        throw new Error('WordPress configuration not initialized');
      }
      
      this.baseUrl = config.WORDPRESS_API_URL;
      this.auth = Buffer.from(`${config.wp_username}:${config.wp_app_password}`).toString('base64');
      
      this.initialized = true;
      this.logger.info('WordPress service initialized');
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
        throw new Error(`WordPress API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Error updating post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = WordPressService;