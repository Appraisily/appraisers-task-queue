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
    this.completeReportTimeout = 360000; // 6 minutes timeout
    this.maxRetries = 3;
    this.retryDelay = 10000; // 10 seconds between retries
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
    this.logger.info(`Updating post metadata for type: ${appraisalType}`);
    
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
        updatedContent += '\n[AppraisalTemplates type="MasterTemplate"]';
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
        appraisaltype: appraisalType || 'Regular' // Use provided type or default to Regular
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
    
    let lastError;
    
    try {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
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

          // Wait for completion confirmation
          const data = await response.json();
          
          if (data.status === 'completed' || response.status === 200) {
            this.logger.info(`Successfully completed appraisal report for post ${postId}`);
            return;
          }
          
          throw new Error('Report completion did not return success status');
        } catch (error) {
          lastError = error;
          
          if (error.name === 'AbortError') {
            throw new Error(`Complete appraisal report timed out after ${this.completeReportTimeout/1000} seconds`);
          }
          
          if (attempt < this.maxRetries) {
            this.logger.warn(`Attempt ${attempt} failed, retrying in ${this.retryDelay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          }
        }
      }

      throw new Error(`Failed to complete report after ${this.maxRetries} attempts. Last error: ${lastError.message}`);
    } catch (finalError) {
      this.logger.error(`Error completing report for post ${postId}:`, finalError);
      throw finalError;
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