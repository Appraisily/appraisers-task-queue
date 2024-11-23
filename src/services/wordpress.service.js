const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPressService');
    this.initialized = false;
    this.baseUrl = null;
    this.auth = null;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing WordPress service...');

      // Validate configuration
      if (!config.WORDPRESS_API_URL) {
        throw new Error('WordPress API URL not configured');
      }
      if (!config.wp_username) {
        throw new Error('WordPress username not configured');
      }
      if (!config.wp_app_password) {
        throw new Error('WordPress app password not configured');
      }

      // Set up API URL and credentials
      this.baseUrl = config.WORDPRESS_API_URL;
      this.auth = Buffer.from(`${config.wp_username}:${config.wp_app_password}`).toString('base64');

      // Test the connection with retries
      let lastError;
      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(`${this.baseUrl}/appraisals`, {
            headers: {
              'Authorization': `Basic ${this.auth}`,
              'Accept': 'application/json',
            },
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`WordPress API test failed: ${response.status} ${response.statusText} - ${errorText}`);
          }

          // Test successful
          this.initialized = true;
          this.logger.info('WordPress service initialized successfully');
          return;
        } catch (error) {
          lastError = error;
          
          if (attempt < this.retryAttempts) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            this.logger.warn(`WordPress connection attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // If we get here, all attempts failed
      throw new Error(`WordPress initialization failed after ${this.retryAttempts} attempts: ${lastError.message}`);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/appraisals/${postId}`, {
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Accept': 'application/json',
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WordPress API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Error getting appraisal ${postId}:`, error);
      throw error;
    }
  }

  async updatePost(postId, data) {
    if (!this.initialized) {
      throw new Error('WordPress service not initialized');
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${this.baseUrl}/appraisals/${postId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WordPress API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Error updating appraisal ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = WordPressService;