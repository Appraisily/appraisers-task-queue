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

  async processAppraisal(id, value, description, userProvidedType = null) {
    try {
      // Step 1: Set Value
      await this.setAppraisalValue(id, value, description);
      
      // Step 2: Merge Descriptions
      const mergedDescription = await this.mergeDescriptions(id, description);
      
      // Step 3: Get appraisal type from Column B
      const spreadsheetType = await this.getAppraisalType(id);
      // Use user provided type if available, otherwise use spreadsheet type
      const appraisalType = userProvidedType || spreadsheetType;
      this.logger.info(`Using appraisal type: ${appraisalType} (${userProvidedType ? 'from message' : 'from spreadsheet'})`);
      
      // Step 4: Update WordPress with type
      const { postId, publicUrl } = await this.updateWordPress(id, value, mergedDescription, appraisalType);
      
      // Save public URL to spreadsheet
      await this.sheetsService.updateValues(`P${id}`, [[publicUrl]]);
      
      // Step 5: Complete Appraisal Report
      await this.wordpressService.completeAppraisalReport(postId);
      
      // Step 6: Generate PDF and Send Email
      await this.finalize(id, postId, publicUrl);
      
      // Step 7: Mark as Complete
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
    
    // Save merged description to Column L
    await this.sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
    
    return mergedDescription;
  }

  async getAppraisalType(id) {
    const values = await this.sheetsService.getValues(`B${id}`);
    this.logger.info(`[DEBUG] Column B value type: ${typeof values?.[0]?.[0]}`);
    this.logger.info(`[DEBUG] Column B raw value: ${values?.[0]?.[0]}`);
    if (!values || !values[0] || !values[0][0]) {
      this.logger.warn(`No appraisal type found for ID ${id}, using default`);
      return 'Regular';
    }
    let appraisalType = values[0][0].toString();
    
    // Validate and normalize appraisal type
    const validTypes = ['Regular', 'IRS', 'Insurance'];
    if (!validTypes.includes(appraisalType)) {
      this.logger.warn(`Invalid appraisal type "${appraisalType}" found for ID ${id}, using default`);
      appraisalType = 'Regular';
    }
    
    this.logger.info(`[DEBUG] Processed appraisal type: ${appraisalType}`);
    return appraisalType;
  }

  async updateWordPress(id, value, mergedDescription, appraisalType) {
    const postId = await this.getWordPressPostId(id);
    
    const post = await this.wordpressService.getPost(postId);
    
    const updatedPost = await this.wordpressService.updateAppraisalPost(postId, {
      title: mergedDescription,
      content: post.content?.rendered || '',
      value: value.toString(),
      appraisalType: appraisalType // Use the provided appraisal type
    });

    return {
      postId,
      publicUrl: updatedPost.publicUrl
    };
  }

  async getWordPressPostId(id) {
    const values = await this.sheetsService.getValues(`G${id}`);
    
    if (!values || !values[0] || !values[0][0]) {
      throw new Error(`No WordPress URL found for appraisal ${id}`);
    }

    const wpUrl = values[0][0];
    const url = new URL(wpUrl);
    const postId = url.searchParams.get('post');
    
    if (!postId) {
      throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
    }

    this.logger.info(`Extracted WordPress post ID: ${postId} from URL: ${wpUrl}`);
    return postId;
  }

  async finalize(id, postId, publicUrl) {
    // Generate PDF
    const { pdfLink, docLink } = await this.pdfService.generatePDF(postId);
    await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]]);
    
    // Get customer data
    const customerData = await this.getCustomerData(id);
    
    // Send email notification and track delivery
    this.logger.info(`Sending completion email to ${customerData.email}`);
    const emailResult = await this.emailService.sendAppraisalCompletedEmail(
      customerData.email,
      customerData.name,
      { 
        pdfLink,
        appraisalUrl: publicUrl
      }
    );

    // Save email delivery status to Column Q
    const emailStatus = `Email sent on ${emailResult.timestamp} (ID: ${emailResult.messageId})`;
    await this.sheetsService.updateValues(`Q${id}`, [[emailStatus]]);
    
    this.logger.info(`Email delivery status saved for appraisal ${id}`);
  }

  async getCustomerData(id) {
    const values = await this.sheetsService.getValues(`D${id}:E${id}`);
    
    if (!values || !values[0] || values[0].length < 2) {
      throw new Error(`Customer data not found for appraisal ${id}`);
    }

    const [email, name] = values[0];
    
    if (!email) {
      throw new Error(`Customer email not found for appraisal ${id}`);
    }

    return {
      email,
      name: name || 'Valued Customer'
    };
  }

  async complete(id) {
    try {
      // First mark as completed
      await this.sheetsService.updateValues(`F${id}`, [['Completed']]);
      
      // Then move to completed sheet
      await this.sheetsService.moveToCompleted(id);
      
      this.logger.info(`Appraisal ${id} marked as complete and moved to Completed Appraisals`);
    } catch (error) {
      this.logger.error(`Error completing appraisal ${id}:`, error);
      throw error;
    }
  }
}

module.exports = AppraisalService;