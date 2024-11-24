const fetch = require('node-fetch');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

class WordPressService {
  constructor() {
    this.logger = createLogger('WordPress');
    this.baseUrl = null;
    this.auth = null;
    this.appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
    this.postCache = new Map(); // Cache for post data
    this.completeReportTimeout = 240000; // 4 minutes timeout
    this.maxRetries = 2;
    this.retryDelay = 10000; // 10 seconds between retries
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
    
    // Update cache with new data
    this.postCache.set(postId, result);
    
    return result;
  }

  async getPost(postId, useCache = true) {
    // Check cache first
    if (useCache && this.postCache.has(postId)) {
      return this.postCache.get(postId);
    }

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
    
    // Update cache
    this.postCache.set(postId, post);
    
    return post;
  }

  async updateAppraisalPost(postId, { title, content, value }) {
    this.logger.info(`Updating appraisal post ${postId}`);
    
    // Get current post to check shortcodes_inserted flag
    const post = await this.getPost(postId);
    const shortcodesInserted = post.acf?.shortcodes_inserted || false;
    
    // Prepare update data
    const updateData = {
      title: title,
      acf: {
        value: value.toString(),
        shortcodes_inserted: true
      }
    };

    // Only update content if shortcodes need to be inserted
    if (!shortcodesInserted) {
      this.logger.info(`Adding shortcodes to post ${postId}`);
      updateData.content = post.content?.rendered || '';
      
      if (!updateData.content.includes('[pdf_download]')) {
        updateData.content += '\n[pdf_download]';
      }
      if (!updateData.content.includes('[AppraisalTemplates')) {
        updateData.content += `\n[AppraisalTemplates type="${post.acf?.type || 'RegularArt'}"]`;
      }
    }

    // Single update call with all changes
    return this.updatePost(postId, updateData);
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
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ 
            postId: postId.toString()
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const responseText = await response.text();
        let result;
        
        try {
          result = JSON.parse(responseText);
        } catch (error) {
          throw new Error(`Invalid JSON response: ${responseText}`);
        }

        if (!response.ok || !result.success) {
          throw new Error(`Failed to complete appraisal report: ${result.message || response.statusText}`);
        }

        // Log detailed success information
        this.logger.info('Appraisal report completed successfully:', {
          postId: result.details.postId,
          title: result.details.title,
          processedFields: result.details.processedFields.length,
          similarImages: result.details.visionAnalysis.similarImagesCount
        });

        // Log individual field processing results
        result.details.processedFields.forEach(field => {
          this.logger.info(`Field processed: ${field.field} (${field.status})`);
        });

        return result;
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