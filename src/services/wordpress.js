const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPress');
    this.baseUrl = null;
    this.auth = null;
    this.appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
    this.postCache = new Map();
    this.completeReportTimeout = 300000; // 5 minutes timeout
  }

  async initialize() {
    const wpUrl = await secretManager.getSecret('WORDPRESS_API_URL');
    const username = await secretManager.getSecret('wp_username');
    const password = await secretManager.getSecret('wp_app_password');

    this.baseUrl = wpUrl.replace(/\/+$/, '');
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    this.logger.info(`WordPress API initialized with base URL: ${this.baseUrl}`);
  }

  async updateAppraisalPost(postId, { title, content, value, appraisalType }) {
    this.logger.info(`Updating appraisal post ${postId}`);
    this.logger.info(`Received appraisal type: ${appraisalType}`);
    
    const post = await this.getPost(postId);
    const shortcodesInserted = post.acf?.shortcodes_inserted || false;
    const sessionId = post.acf?.session_id;
    
    let updatedContent = content;

    // Only add shortcodes if they haven't been added before
    if (!shortcodesInserted) {
      this.logger.info(`Adding shortcodes to post ${postId}`);
      
      // Add PDF download shortcode if not present
      if (!updatedContent.includes('[pdf_download]')) {
        updatedContent += '\n[pdf_download]';
      }

      // Add AppraisalTemplates shortcode with type from spreadsheet
      if (!updatedContent.includes('[AppraisalTemplates')) {
        const templateType = appraisalType || 'RegularArt'; // Default to RegularArt if no type specified
        updatedContent += `\n[AppraisalTemplates type="${templateType}"]`;
      }
    }
    
    const numericPostId = parseInt(postId, 10);
    if (isNaN(numericPostId)) {
      throw new Error(`Invalid post ID: ${postId}`);
    }

    const url = `${this.baseUrl}/appraisals/${numericPostId}`;
    this.logger.info(`Making POST request to: ${url}`);

    // Combine all updates into a single request body
    const requestBody = {
      title: title,
      content: updatedContent,
      status: 'publish',
      acf: {
        value: value.toString(),
        shortcodes_inserted: true,
        appraisaltype: appraisalType || 'RegularArt'
      }
    };

    // Add slug if session ID exists
    if (sessionId) {
      this.logger.info(`Adding slug with session ID: ${sessionId}`);
      requestBody.slug = this.generateSlug(sessionId);
    }

    this.logger.info(`Request body:`, JSON.stringify(requestBody));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`API Error Response: ${errorText}`);
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const updatedPost = await response.json();
    this.logger.info(`Successfully updated post ${postId}`);
    this.logger.info(`Updated ACF fields:`, JSON.stringify(updatedPost.acf));
    
    this.postCache.set(numericPostId, updatedPost);

    return {
      ...updatedPost,
      publicUrl: updatedPost.link
    };
  }

  async getPost(postId, useCache = true) {
    // Ensure postId is a number
    const numericPostId = parseInt(postId, 10);
    if (isNaN(numericPostId)) {
      throw new Error(`Invalid post ID: ${postId}`);
    }

    if (useCache && this.postCache.has(numericPostId)) {
      this.logger.info(`Returning cached post ${numericPostId}`);
      return this.postCache.get(numericPostId);
    }

    const url = `${this.baseUrl}/appraisals/${numericPostId}`;
    this.logger.info(`Making GET request to: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${this.auth}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`API Error Response: ${errorText}`);
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const post = await response.json();
    this.logger.info(`Successfully fetched post ${numericPostId}`);
    
    this.postCache.set(numericPostId, post);
    return post;
  }

  async completeAppraisalReport(postId) {
    this.logger.info(`Completing appraisal report for post ${postId} via appraisals backend`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.completeReportTimeout);

      const response = await fetch(`${this.appraisalsBackendUrl}/complete-appraisal-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ postId: postId.toString() }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to complete appraisal report: ${response.statusText}\n${errorText}`);
      }

      // We expect a 200 status code, but don't need any specific response data
      this.logger.info(`Successfully completed appraisal report for post ${postId}`);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Complete appraisal report timed out after ${this.completeReportTimeout/1000} seconds`);
      }
      throw error;
    }
  }

  generateSlug(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required for generating slug');
    }
    return sessionId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  clearCache() {
    this.postCache.clear();
  }
}

module.exports = WordPressService;