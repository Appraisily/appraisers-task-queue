const { createLogger } = require('../utils/logger');

class AppraisalService {
  constructor(sheetsService, wordpressService, openaiService, emailService, pdfService) {
    this.logger = createLogger('AppraisalService');
    this.sheetsService = sheetsService;
    this.wordpressService = wordpressService;
    this.openaiService = openaiService;
    this.emailService = emailService;
    this.pdfService = pdfService;
  }

  async processAppraisal(id, value, description) {
    try {
      // Step 1: Set Value
      await this.setAppraisalValue(id, value, description);
      
      // Step 2: Merge Descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      
      // Step 3: Update WordPress
      const postId = await this.updateWordPress(id, mergedDescription);
      
      // Step 4: Generate PDF and Send Email
      await this.finalize(id, value, mergedDescription, postId);
      
      // Step 5: Mark as Complete
      await this.complete(id);
      
      this.logger.info(`Successfully processed appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }

  async setAppraisalValue(id, value, description) {
    await this.sheetsService.updateValues(`J${id}:K${id}`, [[value, description]]);
  }

  async mergeDescriptions(id, description) {
    const values = await this.sheetsService.getValues(`H${id}`);
    const iaDescription = values[0][0];
    
    const mergedDescription = await this.openaiService.mergeDescriptions(description, iaDescription);
    await this.sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
    
    return mergedDescription;
  }

  async updateWordPress(id, description) {
    const postId = await this.getWordPressPostId(id);
    const appraisalType = await this.getAppraisalType(id);
    
    // Update title
    await this.wordpressService.updatePost(postId, {
      title: `Appraisal #${id} - ${description.substring(0, 100)}...`
    });
    
    // Update content with shortcodes
    const post = await this.wordpressService.getPost(postId);
    let content = post.content?.rendered || '';
    
    if (!content.includes('[pdf_download]')) {
      content += '\n[pdf_download]';
    }
    
    if (!content.includes(`[AppraisalTemplates type="${appraisalType}"]`)) {
      content += `\n[AppraisalTemplates type="${appraisalType}"]`;
    }
    
    await this.wordpressService.updatePost(postId, {
      content,
      acf: { shortcodes_inserted: true }
    });
    
    return postId;
  }

  async getWordPressPostId(id) {
    const values = await this.sheetsService.getValues(`G${id}`);
    const wpUrl = values[0][0];
    
    if (!wpUrl) {
      throw new Error(`No WordPress URL found for appraisal ${id}`);
    }

    const url = new URL(wpUrl);
    const postId = url.searchParams.get('post');
    
    if (!postId) {
      throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
    }

    return postId;
  }

  async getAppraisalType(id) {
    const values = await this.sheetsService.getValues(`B${id}`);
    return values[0][0] || 'RegularArt';
  }

  async finalize(id, value, description, postId) {
    // Generate PDF
    const { pdfLink, docLink } = await this.pdfService.generatePDF(postId);
    await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]]);
    
    // Send email
    const customerData = await this.getCustomerData(id);
    await this.emailService.sendAppraisalCompletedEmail(
      customerData.email,
      customerData.name,
      { value, pdfLink, description }
    );
  }

  async getCustomerData(id) {
    const values = await this.sheetsService.getValues(`D${id}:E${id}`);
    return {
      email: values[0][0],
      name: values[0][1]
    };
  }

  async complete(id) {
    await this.sheetsService.updateValues(`F${id}`, [['Completed']]);
  }
}

module.exports = AppraisalService;