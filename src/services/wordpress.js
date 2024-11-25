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
    this.completeReportTimeout = 240000;
    this.maxRetries = 2;
    this.retryDelay = 10000;
  }

  async initialize() {
    const wpUrl = await secretManager.getSecret('WORDPRESS_API_URL');
    const username = await secretManager.getSecret('wp_username');
    const password = await secretManager.getSecret('wp_app_password');

    // Remove trailing slashes and ensure clean base URL
    this.baseUrl = wpUrl.replace(/\/+$/, '');
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');
  }

  generateSlug(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required for generating slug');
    }
    return sessionId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  async updatePost(postId, data) {
    this.logger.info(`Updating WordPress post ${postId}`);
    
    const response = await fetch(`${this.baseUrl}/posts/${postId}`, {
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
      const errorText = await response.text();
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();
    this.logger.info(`Successfully updated post ${postId}`);
    
    this.postCache.set(postId, result);
    return result;
  }

  async getPost(postId, useCache = true) {
    if (useCache && this.postCache.has(postId)) {
      return this.postCache.get(postId);
    }

    this.logger.info(`Fetching WordPress post ${postId}`);
    
    const response = await fetch(`${this.baseUrl}/posts/${postId}`, {
      headers: {
        'Authorization': `Basic ${this.auth}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WordPress API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const post = await response.json();
    this.logger.info(`Successfully fetched post ${postId}`);
    
    this.postCache.set(postId, post);
    return post;
  }

  async updateAppraisalPost(postId, { title, content, value }) {
    this.logger.info(`Updating appraisal post ${postId}`);
    
    const post = await this.getPost(postId);
    const shortcodesInserted = post.acf?.shortcodes_inserted || false;
    const sessionId = post.acf?.session_id;
    
    let updatedContent = content;

    // Add shortcodes if not already present
    if (!shortcodesInserted) {
      this.logger.info(`Adding shortcodes to post ${postId}`);
      if (!updatedContent.includes('[pdf_download]')) {
        updatedContent += '\n[pdf_download]';
      }
      if (!updatedContent.includes('[AppraisalTemplates')) {
        updatedContent += `\n[AppraisalTemplates type="${post.acf?.type || 'RegularArt'}"]`;
      }
    }
    
    const updateData = {
      title: title,
      content: updatedContent,
      acf: {
        value: value.toString(),
        shortcodes_inserted: true
      }
    };

    // Only update slug if session ID exists
    if (sessionId) {
      this.logger.info(`Updating slug with session ID: ${sessionId}`);
      updateData.slug = this.generateSlug(sessionId);
    }

    const updatedPost = await this.updatePost(postId, updateData);
    return {
      ...updatedPost,
      publicUrl: updatedPost.link
    };
  }

  async completeAppraisalReport(postId) {
    this.logger.info(`Completing appraisal report for post ${postId} via appraisals backend`);
    
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
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

        this.logger.info(`Successfully completed appraisal report for post ${postId}`);
        return;
      } catch (error) {
        lastError = error;
        if (error.name === 'AbortError') {
          this.logger.warn(`Complete appraisal report timed out after ${this.completeReportTimeout/1000} seconds`);
        } else {
          this.logger.warn(`Complete appraisal report attempt ${attempt} failed:`, error.message);
        }
        
        if (attempt <= this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    throw new Error(`Complete appraisal report failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }

  clearCache() {
    this.postCache.clear();
  }
}

module.exports = WordPressService;