const fetch = require('node-fetch');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPressService');
  }

  async initialize() {
    try {
      if (!config.WORDPRESS_API_URL || !config.WORDPRESS_USERNAME || !config.WORDPRESS_APP_PASSWORD) {
        throw new Error('WordPress configuration not initialized');
      }
      
      this.baseUrl = config.WORDPRESS_API_URL;
      this.auth = Buffer.from(`${config.WORDPRESS_USERNAME}:${config.WORDPRESS_APP_PASSWORD}`).toString('base64');
      
      this.logger.info('WordPress service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize WordPress service:', error);
      throw error;
    }
  }

  async getPost(postId) {
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

module.exports = new WordPressService();