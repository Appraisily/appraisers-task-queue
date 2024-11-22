const sheetsService = require('./sheets.service');
const wordpressService = require('./wordpress.service');
const openaiService = require('./openai.service');
const emailService = require('./email.service');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');

class AppraisalService {
  constructor() {
    this.logger = createLogger('AppraisalService');
  }

  async setAppraisalValue(id, appraisalValue, description) {
    this.logger.info(`Setting appraisal value for ID ${id}`);
    
    await sheetsService.updateValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!J${id}:K${id}`,
      [[appraisalValue, description]]
    );

    const values = await sheetsService.getValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!G${id}`
    );

    const wordpressUrl = values[0][0];
    const postId = new URL(wordpressUrl).searchParams.get('post');

    await wordpressService.updatePost(postId, {
      acf: { value: appraisalValue }
    });
  }

  async mergeDescriptions(id, appraiserDescription) {
    this.logger.info(`Merging descriptions for ID ${id}`);
    
    const values = await sheetsService.getValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!H${id}`
    );

    const iaDescription = values[0][0];
    const mergedDescription = await openaiService.mergeDescriptions(
      appraiserDescription,
      iaDescription
    );

    await sheetsService.updateValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!L${id}`,
      [[mergedDescription]]
    );

    return mergedDescription;
  }

  async updateTitle(id, mergedDescription) {
    this.logger.info(`Updating title for ID ${id}`);
    
    const values = await sheetsService.getValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!G${id}`
    );

    const wordpressUrl = values[0][0];
    const postId = new URL(wordpressUrl).searchParams.get('post');

    await wordpressService.updatePost(postId, {
      title: mergedDescription
    });

    return postId;
  }

  async insertTemplate(id) {
    this.logger.info(`Inserting template for ID ${id}`);
    
    const values = await sheetsService.getValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!A${id}:G${id}`
    );

    const row = values[0];
    const appraisalType = row[1] || 'RegularArt';
    const wordpressUrl = row[6];
    const postId = new URL(wordpressUrl).searchParams.get('post');

    const wpData = await wordpressService.getPost(postId);
    let content = wpData.content?.rendered || '';

    if (!content.includes('[pdf_download]')) {
      content += '\n[pdf_download]';
    }

    if (!content.includes(`[AppraisalTemplates type="${appraisalType}"]`)) {
      content += `\n[AppraisalTemplates type="${appraisalType}"]`;
    }

    await wordpressService.updatePost(postId, {
      content,
      acf: { shortcodes_inserted: true }
    });
  }

  async buildPdf(id) {
    this.logger.info(`Building PDF for ID ${id}`);
    
    const values = await sheetsService.getValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!A${id}:G${id}`
    );

    const row = values[0];
    const wordpressUrl = row[6];
    const postId = new URL(wordpressUrl).searchParams.get('post');

    const wpData = await wordpressService.getPost(postId);
    const session_ID = wpData.acf?.session_id;

    const response = await fetch(
      'https://appraisals-backend-856401495068.us-central1.run.app/generate-pdf',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, session_ID })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to generate PDF');
    }

    const data = await response.json();
    await sheetsService.updateValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!M${id}:N${id}`,
      [[data.pdfLink, data.docLink]]
    );

    return data;
  }

  async sendEmail(id) {
    this.logger.info(`Sending email for ID ${id}`);
    
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

    await emailService.sendAppraisalCompletedEmail(customerEmail, customerName, {
      value: appraisalValue,
      description: description,
      pdfLink: pdfLink,
      wordpressUrl: wordpressUrl
    });
  }

  async complete(id, appraisalValue, description) {
    this.logger.info(`Completing appraisal ID ${id}`);
    
    await sheetsService.updateValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!F${id}`,
      [['Completed']]
    );

    await sheetsService.updateValues(
      config.PENDING_APPRAISALS_SPREADSHEET_ID,
      `${config.GOOGLE_SHEET_NAME}!J${id}:K${id}`,
      [[appraisalValue, description]]
    );
  }

  async processAppraisal(id, appraisalValue, description) {
    this.logger.info(`Starting appraisal process for ID ${id}`);
    
    try {
      await this.setAppraisalValue(id, appraisalValue, description);
      this.logger.info('✓ Value set successfully');

      const mergedDescription = await this.mergeDescriptions(id, description);
      this.logger.info('✓ Descriptions merged successfully');

      await this.updateTitle(id, mergedDescription);
      this.logger.info('✓ Title updated successfully');

      await this.insertTemplate(id);
      this.logger.info('✓ Template inserted successfully');

      await this.buildPdf(id);
      this.logger.info('✓ PDF built successfully');

      await this.sendEmail(id);
      this.logger.info('✓ Email sent successfully');

      await this.complete(id, appraisalValue, description);
      this.logger.info('✓ Appraisal marked as complete');

      this.logger.info(`Completed appraisal process for ID ${id}`);
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }
}

module.exports = new AppraisalService();