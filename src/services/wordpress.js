const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPress');
    this.baseUrl = null;
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

    return await response.json();
  }

  async getPost(postId) {
    const response = await fetch(`${this.baseUrl}/appraisals/${postId}`, {
      headers: {
        'Authorization': `Basic ${this.auth}`
      }
    });

    if (!response.ok) {
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async updateAppraisalPost(postId, { title, content, value }) {
    return this.updatePost(postId, {
      title: title,
      content: content,
      acf: {
        value: value,
        shortcodes_inserted: true
      }
    });
  }
}

// Export the class itself, not an instance
module.exports = WordPressService;