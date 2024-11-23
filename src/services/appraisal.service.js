const { createLogger } = require('../utils/logger');
const SheetsService = require('./sheets.service');
const WordPressService = require('./wordpress.service');
const OpenAIService = require('./openai.service');
const EmailService = require('./email.service');
const PDFService = require('./pdf.service');

class AppraisalService {
  constructor() {
    this.logger = createLogger('AppraisalService');
    this.initialized = false;
    this.config = null;
    
    // Initialize service instances
    this.sheetsService = new SheetsService();
    this.wordpressService = new WordPressService();
    this.openaiService = new OpenAIService();
    this.emailService = new EmailService();
    this.pdfService = new PDFService();
  }

  async initialize(config) {
    if (this.initialized) {
      return;
    }

    try {
      this.config = config;
      
      // Initialize all required services
      await Promise.all([
        this.sheetsService.initialize(config),
        this.wordpressService.initialize(config),
        this.openaiService.initialize(config),
        this.emailService.initialize(config)
      ]);

      this.initialized = true;
      this.logger.info('Appraisal service initialized');
    } catch (error) {
      this.initialized = false;
      this.logger.error('Failed to initialize appraisal service:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  // Rest of the AppraisalService implementation remains the same, but using this.sheetsService, 
  // this.wordpressService, etc. instead of the imported services

  async processAppraisal(id, appraisalValue, description) {
    if (!this.initialized) {
      throw new Error('Appraisal service not initialized');
    }

    this.logger.info(`Starting appraisal process for ID ${id}`);
    
    try {
      // Step 1: Set Value
      await this.setAppraisalValue(id, appraisalValue, description);
      this.logger.info('✓ Value set successfully');

      // Step 2: Merge Descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      this.logger.info('✓ Descriptions merged successfully');

      // Step 3: Update Title
      await this.updateTitle(id, mergedDescription);
      this.logger.info('✓ Title updated successfully');

      // Step 4: Insert Template
      await this.insertTemplate(id);
      this.logger.info('✓ Template inserted successfully');

      // Step 5: Build PDF
      await this.buildPdf(id);
      this.logger.info('✓ PDF built successfully');

      // Step 6: Send Email
      await this.sendEmail(id);
      this.logger.info('✓ Email sent successfully');

      // Step 7: Mark as Complete
      await this.complete(id, appraisalValue, description);
      this.logger.info('✓ Appraisal marked as complete');

      this.logger.info(`Completed appraisal process for ID ${id}`);
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }

  async setAppraisalValue(id, appraisalValue, description) {
    this.logger.info(`Setting appraisal value for ID ${id}`);
    
    try {
      // Update Google Sheets with value and description
      await this.sheetsService.updateValues(
        `${this.config.GOOGLE_SHEET_NAME}!J${id}:K${id}`,
        [[appraisalValue, description]]
      );

      // Get WordPress URL from sheets
      const values = await this.sheetsService.getValues(
        `${this.config.GOOGLE_SHEET_NAME}!G${id}`
      );

      if (!values || !values[0] || !values[0][0]) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      const wordpressUrl = values[0][0];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      if (!postId) {
        throw new Error(`Invalid WordPress URL for appraisal ${id}`);
      }

      // Update WordPress post with value
      await this.wordpressService.updatePost(postId, {
        acf: { value: appraisalValue }
      });

      this.logger.info(`Successfully set value for appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error setting value for appraisal ${id}:`, error);
      throw error;
    }
  }

  async mergeDescriptions(id, appraiserDescription) {
    this.logger.info(`Merging descriptions for ID ${id}`);
    
    try {
      // Get IA description from sheets
      const values = await this.sheetsService.getValues(
        `${this.config.GOOGLE_SHEET_NAME}!H${id}`
      );

      if (!values || !values[0]) {
        throw new Error(`No IA description found for appraisal ${id}`);
      }

      const iaDescription = values[0][0];
      
      // Use OpenAI to merge descriptions
      const mergedDescription = await this.openaiService.mergeDescriptions(
        appraiserDescription,
        iaDescription
      );

      // Save merged description to sheets
      await this.sheetsService.updateValues(
        `${this.config.GOOGLE_SHEET_NAME}!L${id}`,
        [[mergedDescription]]
      );

      this.logger.info(`Successfully merged descriptions for appraisal ${id}`);
      return mergedDescription;
    } catch (error) {
      this.logger.error(`Error merging descriptions for appraisal ${id}:`, error);
      throw error;
    }
  }

  async updateTitle(id, mergedDescription) {
    this.logger.info(`Updating title for ID ${id}`);
    
    try {
      // Get WordPress URL from sheets
      const values = await this.sheetsService.getValues(
        `${this.config.GOOGLE_SHEET_NAME}!G${id}`
      );

      if (!values || !values[0] || !values[0][0]) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      const wordpressUrl = values[0][0];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      if (!postId) {
        throw new Error(`Invalid WordPress URL for appraisal ${id}`);
      }

      // Update WordPress post title
      await this.wordpressService.updatePost(postId, {
        title: `Appraisal #${id} - ${mergedDescription.substring(0, 100)}...`
      });

      this.logger.info(`Successfully updated title for appraisal ${id}`);
      return postId;
    } catch (error) {
      this.logger.error(`Error updating title for appraisal ${id}:`, error);
      throw error;
    }
  }

  async insertTemplate(id) {
    this.logger.info(`Inserting template for ID ${id}`);
    
    try {
      // Get appraisal type and WordPress URL from sheets
      const values = await this.sheetsService.getValues(
        `${this.config.GOOGLE_SHEET_NAME}!A${id}:G${id}`
      );

      if (!values || !values[0]) {
        throw new Error(`No data found for appraisal ${id}`);
      }

      const row = values[0];
      const appraisalType = row[1] || 'RegularArt';
      const wordpressUrl = row[6];

      if (!wordpressUrl) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      const postId = new URL(wordpressUrl).searchParams.get('post');

      if (!postId) {
        throw new Error(`Invalid WordPress URL for appraisal ${id}`);
      }

      // Get current post content
      const wpData = await this.wordpressService.getPost(postId);
      let content = wpData.content?.rendered || '';

      // Add required shortcodes if not present
      if (!content.includes('[pdf_download]')) {
        content += '\n[pdf_download]';
      }

      if (!content.includes(`[AppraisalTemplates type="${appraisalType}"]`)) {
        content += `\n[AppraisalTemplates type="${appraisalType}"]`;
      }

      // Update WordPress post
      await this.wordpressService.updatePost(postId, {
        content,
        acf: { shortcodes_inserted: true }
      });

      this.logger.info(`Successfully inserted template for appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error inserting template for appraisal ${id}:`, error);
      throw error;
    }
  }

  async buildPdf(id) {
    this.logger.info(`Building PDF for ID ${id}`);
    
    try {
      // Get WordPress URL from sheets
      const values = await this.sheetsService.getValues(
        `${this.config.GOOGLE_SHEET_NAME}!A${id}:G${id}`
      );

      if (!values || !values[0]) {
        throw new Error(`No data found for appraisal ${id}`);
      }

      const row = values[0];
      const wordpressUrl = row[6];

      if (!wordpressUrl) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      const postId = new URL(wordpressUrl).searchParams.get('post');

      if (!postId) {
        throw new Error(`Invalid WordPress URL for appraisal ${id}`);
      }

      // Get session ID from WordPress
      const wpData = await this.wordpressService.getPost(postId);
      const sessionId = wpData.acf?.session_id;

      if (!sessionId) {
        throw new Error(`No session ID found for WordPress post ${postId}`);
      }

      // Generate PDF using PDF service
      const { pdfLink, docLink } = await this.pdfService.generatePDF(postId, sessionId);

      // Update sheets with PDF and Doc links
      await this.sheetsService.updateValues(
        `${this.config.GOOGLE_SHEET_NAME}!M${id}:N${id}`,
        [[pdfLink, docLink]]
      );

      this.logger.info(`Successfully built PDF for appraisal ${id}`);
      return { pdfLink, docLink };
    } catch (error) {
      this.logger.error(`Error building PDF for appraisal ${id}:`, error);
      throw error;
    }
  }

  async sendEmail(id) {
    this.logger.info(`Sending email for ID ${id}`);
    
    try {
      // Get all required data from sheets
      const values = await this.sheetsService.getValues(
        `${this.config.GOOGLE_SHEET_NAME}!A${id}:N${id}`
      );

      if (!values || !values[0]) {
        throw new Error(`No data found for appraisal ${id}`);
      }

      const row = values[0];
      const customerEmail = row[3];
      const customerName = row[4];
      const wordpressUrl = row[6];
      const appraisalValue = row[9];
      const description = row[10];
      const pdfLink = row[12];

      if (!customerEmail || !customerName || !wordpressUrl || !appraisalValue || !description || !pdfLink) {
        throw new Error(`Missing required data for email notification, appraisal ${id}`);
      }

      // Send email using email service
      await this.emailService.sendAppraisalCompletedEmail(customerEmail, customerName, {
        value: appraisalValue,
        description: description,
        pdfLink: pdfLink,
        wordpressUrl: wordpressUrl
      });

      this.logger.info(`Successfully sent email for appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error sending email for appraisal ${id}:`, error);
      throw error;
    }
  }

  async complete(id, appraisalValue, description) {
    this.logger.info(`Completing appraisal ID ${id}`);
    
    try {
      // Update status to completed
      await this.sheetsService.updateValues(
        `${this.config.GOOGLE_SHEET_NAME}!F${id}`,
        [['Completed']]
      );

      // Update final value and description
      await this.sheetsService.updateValues(
        `${this.config.GOOGLE_SHEET_NAME}!J${id}:K${id}`,
        [[appraisalValue, description]]
      );

      this.logger.info(`Successfully completed appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error completing appraisal ${id}:`, error);
      throw error;
    }
  }
}

module.exports = new AppraisalService();