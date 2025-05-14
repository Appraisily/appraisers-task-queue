const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const secretManager = require('../utils/secrets');

/**
 * Service for converting Markdown to Google Docs and PDF
 */
class GoogleDocsService {
  constructor() {
    this.logger = createLogger('GoogleDocsService');
    this.authClient = null;
    this.drive = null;
    this.templatePath = path.join(__dirname, '../templates/appraisal-template.md');
  }

  /**
   * Initialize the Google Docs service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing Google Docs service...');
      
      // Get Google credentials from Secret Manager
      const serviceAccountKey = await secretManager.getSecret('GOOGLE_SERVICE_ACCOUNT_KEY');
      
      if (!serviceAccountKey) {
        throw new Error('Missing Google service account key in Secret Manager');
      }

      // Parse the service account key
      const credentials = JSON.parse(serviceAccountKey);
      
      // Create JWT client
      this.authClient = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/drive']
      );

      // Create Drive API client
      this.drive = google.drive({ version: 'v3', auth: this.authClient });
      
      this.logger.info('Google Docs service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Google Docs service:', error);
      throw error;
    }
  }

  /**
   * Process the template with data
   * @param {Object} data - The data to fill the template with
   * @returns {Promise<string>} - The processed markdown content
   */
  async processTemplate(data) {
    try {
      // Read the template file
      const template = await fs.promises.readFile(this.templatePath, 'utf8');
      
      // Replace placeholders with data
      const processedTemplate = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
      });
      
      return processedTemplate;
    } catch (error) {
      this.logger.error('Error processing markdown template:', error);
      throw error;
    }
  }

  /**
   * Convert markdown to Google Doc and optionally to PDF
   * @param {string} markdownContent - The markdown content
   * @param {Object} options - Options for conversion
   * @returns {Promise<Object>} - The result with docUrl and optional fileContent
   */
  async markdownToGoogleDoc(markdownContent, options = {}) {
    try {
      if (!this.authClient || !this.drive) {
        await this.initialize();
      }
      
      // Default options
      const defaultOptions = {
        filename: `Appraisal-${Date.now()}`,
        convertToPdf: false,
        folderId: null // Optional folder ID to upload to
      };
      
      const mergedOptions = { ...defaultOptions, ...options };
      
      // Prepare request body
      const requestBody = {
        name: mergedOptions.filename,
        mimeType: 'application/vnd.google-apps.document'
      };
      
      // If folder ID is provided, set parent
      if (mergedOptions.folderId) {
        requestBody.parents = [mergedOptions.folderId];
      }
      
      // Upload the file initially as plain text
      const uploadResponse = await this.drive.files.create({
        requestBody: {
          name: mergedOptions.filename + '.md', 
          mimeType: 'text/markdown'
        },
        media: {
          mimeType: 'text/markdown',
          body: markdownContent
        },
        fields: 'id'
      });
      
      const uploadedFileId = uploadResponse.data.id;
      this.logger.info(`Markdown file uploaded with ID: ${uploadedFileId}`);
      
      // Now convert it to a Google Doc
      const copyResponse = await this.drive.files.copy({
        fileId: uploadedFileId,
        requestBody: {
          name: mergedOptions.filename,
          mimeType: 'application/vnd.google-apps.document'
        }
      });
      
      const docId = copyResponse.data.id;
      this.logger.info(`Converted to Google Doc with ID: ${docId}`);
      
      // Delete the original markdown file
      await this.drive.files.delete({
        fileId: uploadedFileId
      });
      
      // Create a shareable link
      await this.drive.permissions.create({
        fileId: docId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
      
      // Get the web view link
      const docResponse = await this.drive.files.get({
        fileId: docId,
        fields: 'webViewLink'
      });
      
      const docUrl = docResponse.data.webViewLink;
      
      // If PDF conversion is requested
      if (mergedOptions.convertToPdf) {
        const pdfResponse = await this.drive.files.export({
          fileId: docId,
          mimeType: 'application/pdf'
        }, {
          responseType: 'arraybuffer'
        });
        
        // Return both the Doc URL and PDF content
        return {
          docId,
          docUrl,
          fileContent: Buffer.from(pdfResponse.data)
        };
      }
      
      // Return just the Doc URL if no PDF requested
      return {
        docId,
        docUrl
      };
    } catch (error) {
      this.logger.error('Error converting Markdown to Google Doc:', error);
      throw error;
    }
  }

  /**
   * Generate a document from WordPress post
   * @param {string} postId - The WordPress post ID
   * @param {Object} options - Options for conversion
   * @param {Object} wordpressService - WordPress service instance
   * @returns {Promise<Object>} - The result with docUrl and optional fileContent
   */
  async generateDocFromWordPressPost(postId, options = {}, wordpressService) {
    try {
      this.logger.info(`Generating document for WordPress post ${postId}`);
      
      // Get WordPress data
      const postData = await wordpressService.getPost(postId);
      
      // Transform WordPress data to template format
      const templateData = this.transformWordPressDataToTemplateFormat(postData);
      
      // Process template with data
      const filledMarkdown = await this.processTemplate(templateData);
      
      // Convert to Google Doc
      const result = await this.markdownToGoogleDoc(filledMarkdown, options);
      
      this.logger.info(`Document generated successfully for post ${postId}`);
      return result;
    } catch (error) {
      this.logger.error(`Error generating document for post ${postId}:`, error);
      throw error;
    }
  }

  /**
   * Transform WordPress post data to template format
   * @param {Object} postData - The WordPress post data
   * @returns {Object} - The transformed data for the template
   */
  transformWordPressDataToTemplateFormat(postData) {
    // Extract needed fields from WordPress data
    const acf = postData.acf || {};
    
    return {
      appraisal_title: postData.title?.rendered || '',
      Introduction: postData.content?.rendered || '',
      appraisal_date: new Date().toLocaleDateString(),
      appraisal_value: acf.value || '',
      ImageAnalysisText: acf.image_analysis || '',
      gallery: acf.gallery || '',
      test: acf.test || '',
      age_text: acf.age_text || '',
      age1: acf.age1 || '',
      age_image: acf.age_image || '',
      condition: acf.condition || '',
      condition_summary: acf.condition_summary || '',
      authorship: acf.authorship || '',
      SignatureText: acf.signature_text || '',
      signature1: acf.signature1 || '',
      signature2: acf.signature2 || '',
      signature_image: acf.signature_image || '',
      style: acf.style || '',
      valuation_method: acf.valuation_method || '',
      conclusion1: acf.conclusion1 || '',
      conclusion2: acf.conclusion2 || '',
      statistics_summary_text: acf.statistics_summary_text || '',
      top_auction_results: acf.top_auction_results || '',
      object_type: acf.object_type || '',
      creator: acf.creator || '',
      estimated_age: acf.estimated_age || '',
      medium: acf.medium || '',
      table: acf.table || '',
      main_image: acf.main_image || '',
      customer_name: acf.customer_name || '',
      customer_address: acf.customer_address || '',
      AppraiserText: acf.appraiser_text || '',
      LiabilityText: acf.liability_text || '',
      SellingGuideText: acf.selling_guide_text || '',
      ad_copy: acf.ad_copy || '',
      glossary: acf.glossary || '',
      justification_html: acf.justification_html || ''
    };
  }
}

module.exports = GoogleDocsService; 