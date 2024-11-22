const sheetsService = require('./sheets.service');
const wordpressService = require('./wordpress.service');
const openaiService = require('./openai.service');
const emailService = require('./email.service');
const pdfService = require('./pdf.service');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');

class AppraisalSteps {
  constructor() {
    this.logger = createLogger('AppraisalSteps');
  }

  async setAppraisalValue(id, appraisalValue, description) {
    this.logger.info(`Setting appraisal value for ID ${id}`);
    
    try {
      // Update Google Sheets with value and description
      await sheetsService.updateValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!J${id}:K${id}`,
        [[appraisalValue, description]]
      );

      // Get WordPress URL from sheets
      const values = await sheetsService.getValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!G${id}`
      );

      const wordpressUrl = values[0][0];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      // Update WordPress post with value
      await wordpressService.updatePost(postId, {
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
      const values = await sheetsService.getValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!H${id}`
      );

      const iaDescription = values[0][0];
      
      // Use OpenAI to merge descriptions
      const mergedDescription = await openaiService.mergeDescriptions(
        appraiserDescription,
        iaDescription
      );

      // Save merged description to sheets
      await sheetsService.updateValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!L${id}`,
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
      const values = await sheetsService.getValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!G${id}`
      );

      const wordpressUrl = values[0][0];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      // Update WordPress post title
      await wordpressService.updatePost(postId, {
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
      const values = await sheetsService.getValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!A${id}:G${id}`
      );

      const row = values[0];
      const appraisalType = row[1] || 'RegularArt';
      const wordpressUrl = row[6];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      // Get current post content
      const wpData = await wordpressService.getPost(postId);
      let content = wpData.content?.rendered || '';

      // Add required shortcodes if not present
      if (!content.includes('[pdf_download]')) {
        content += '\n[pdf_download]';
      }

      if (!content.includes(`[AppraisalTemplates type="${appraisalType}"]`)) {
        content += `\n[AppraisalTemplates type="${appraisalType}"]`;
      }

      // Update WordPress post
      await wordpressService.updatePost(postId, {
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
      const values = await sheetsService.getValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!A${id}:G${id}`
      );

      const row = values[0];
      const wordpressUrl = row[6];
      const postId = new URL(wordpressUrl).searchParams.get('post');

      // Get session ID from WordPress
      const wpData = await wordpressService.getPost(postId);
      const sessionId = wpData.acf?.session_id;

      // Generate PDF using PDF service
      const { pdfLink, docLink } = await pdfService.generatePDF(postId, sessionId);

      // Update sheets with PDF and Doc links
      await sheetsService.updateValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!M${id}:N${id}`,
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
      const values = await sheetsService.getValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!A${id}:N${id}`
      );

      const row = values[0];
      const customerEmail = row[3];
      const customerName = row[4];
      const wordpressUrl = row[6];
      const appraisalValue = row[9];
      const description = row[10];
      const pdfLink = row[12];

      // Send email using email service
      await emailService.sendAppraisalCompletedEmail(customerEmail, customerName, {
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
      await sheetsService.updateValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!F${id}`,
        [['Completed']]
      );

      // Update final value and description
      await sheetsService.updateValues(
        config.PENDING_APPRAISALS_SPREADSHEET_ID,
        `${config.GOOGLE_SHEET_NAME}!J${id}:K${id}`,
        [[appraisalValue, description]]
      );

      this.logger.info(`Successfully completed appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error completing appraisal ${id}:`, error);
      throw error;
    }
  }
}

module.exports = new AppraisalSteps();