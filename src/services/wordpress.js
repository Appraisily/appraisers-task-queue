const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPress');
    this.baseUrl = null;
    this.appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
    this.auth = null;
  }

  async initialize() {
    const wpUrl = await secretManager.getSecret('WORDPRESS_API_URL');
    const username = await secretManager.getSecret('wp_username');
    const password = await secretManager.getSecret('wp_app_password');

    this.baseUrl = wpUrl.replace(/\/+$/, '');
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');
  }

  async updatePost(postId, data) {
    this.logger.info(`Updating WordPress post ${postId}`);
    
    const response = await fetch(`${this.baseUrl}/appraisals/${postId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...data,
        status: 'publish'
      })
    });

    if (!response.ok) {
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    this.logger.info(`Successfully updated post ${postId}`);
    return result;
  }

  async getPost(postId) {
    this.logger.info(`Fetching WordPress post ${postId}`);
    
    const response = await fetch(`${this.baseUrl}/appraisals/${postId}`, {
      headers: {
        'Authorization': `Basic ${this.auth}`
      }
    });

    if (!response.ok) {
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
    }

    const post = await response.json();
    this.logger.info(`Successfully fetched post ${postId}`);
    return post;
  }

  async updateAppraisalPost(postId, { title, content, value }) {
    this.logger.info(`Updating appraisal post ${postId}`);
    
    return this.updatePost(postId, {
      title: title,
      content: content,
      acf: {
        value: value.toString(), // Ensure value is string for ACF
        shortcodes_inserted: true
      }
    });
  }

  async completeAppraisalReport(postId) {
    this.logger.info(`Completing appraisal report for post ${postId} via appraisals backend`);
    
    const response = await fetch(`${this.appraisalsBackendUrl}/complete-appraisal-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ postId })
    });

    if (!response.ok) {
      throw new Error(`Failed to complete appraisal report: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to complete appraisal report');
    }

    this.logger.info(`Successfully completed appraisal report for post ${postId}`);
    return result;
  }
}

module.exports = WordPressService;