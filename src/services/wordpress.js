const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPress');
    this.baseUrl = null;
    this.auth = null;
    this.appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
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
    
    // Get current post to check shortcodes_inserted flag
    const post = await this.getPost(postId);
    const shortcodesInserted = post.acf?.shortcodes_inserted || false;
    
    // Only add shortcodes if they haven't been inserted yet
    let finalContent = content;
    if (!shortcodesInserted) {
      this.logger.info(`Adding shortcodes to post ${postId}`);
      if (!content.includes('[pdf_download]')) {
        finalContent += '\n[pdf_download]';
      }
      if (!content.includes('[AppraisalTemplates')) {
        finalContent += `\n[AppraisalTemplates type="${post.acf?.type || 'RegularArt'}"]`;
      }
    }

    return this.updatePost(postId, {
      title: title,
      content: finalContent,
      acf: {
        value: value.toString(),
        shortcodes_inserted: true // Always set to true after update
      }
    });
  }

  async completeAppraisalReport(postId) {
    this.logger.info(`Completing appraisal report for post ${postId} via appraisals backend`);
    
    const response = await fetch(`${this.appraisalsBackendUrl}/complete-appraisal-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ 
        postId: postId.toString() // Ensure postId is a string
      }),
      timeout: 30000 // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to complete appraisal report: ${response.statusText}. Details: ${errorText}`);
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