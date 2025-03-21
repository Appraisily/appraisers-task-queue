const { createLogger } = require('../utils/logger');

class AppraisalService {
  constructor(sheetsService, wordpressService, openaiService, emailService, pdfService) {
    this.logger = createLogger('AppraisalService');
    this.sheetsService = sheetsService;
    this.wordpressService = wordpressService;
    this.openaiService = openaiService;
    this.emailService = emailService;
    this.pdfService = pdfService;
    this.sessionIds = new Map(); // Cache for session IDs
  }

  async processAppraisal(id, value, description, userProvidedType = null) {
    try {
      // Get session ID first for logging
      const sessionId = await this.getSessionId(id);
      
      // Update initial status
      await this.updateStatus(id, 'Processing', { sessionId });

      // Step 1: Set Value
      await this.setAppraisalValue(id, value, description, { sessionId });
      
      // Step 2: Merge Descriptions
      await this.updateStatus(id, 'Merging Descriptions', { sessionId });
      const mergedDescription = await this.mergeDescriptions(id, description, { sessionId });
      
      // Step 3: Get appraisal type from Column B
      const spreadsheetType = await this.getAppraisalType(id, { sessionId });
      // Use user provided type if available, otherwise use spreadsheet type
      const appraisalType = userProvidedType || spreadsheetType;
      this.logger.info(`Using appraisal type: ${appraisalType} (${userProvidedType ? 'from message' : 'from spreadsheet'})`, { sessionId });
      
      // Step 4: Update WordPress with type
      await this.updateStatus(id, 'Updating WordPress', { sessionId });
      const updateResult = await this.updateWordPress(id, value, mergedDescription, appraisalType, { sessionId });
      
      if (!updateResult.success) {
        this.logger.error(`Failed to update WordPress for appraisal ${id}:`, updateResult.error, { sessionId });
        await this.updateStatus(id, 'Error: WordPress Update Failed', { sessionId });
        throw new Error(`WordPress update failed: ${updateResult.error.message}`);
      }
      
      const { postId, publicUrl } = updateResult;
      
      // Step 5: Finalize Appraisal (generate PDF and send email)
      await this.updateStatus(id, 'Finalizing', { sessionId });
      await this.finalize(id, postId, publicUrl, { sessionId });
      
      // Step 6: Mark as Complete
      await this.updateStatus(id, 'Complete', { sessionId });
      await this.complete(id, { sessionId });
      
      this.logger.info(`Appraisal ${id} processed successfully`, { sessionId });
      return { success: true, id, postId };
    } catch (error) {
      const sessionId = this.sessionIds.get(id);
      this.logger.error(`Error processing appraisal ${id}:`, error, { sessionId });
      
      // Update status to Error in spreadsheet
      try {
        await this.updateStatus(id, `Error: ${error.message?.substring(0, 100) || 'Unknown Error'}`, { sessionId });
      } catch (statusError) {
        this.logger.error(`Failed to update error status for appraisal ${id}:`, statusError, { sessionId });
      }
      
      return { success: false, id, error };
    }
  }

  async getSessionId(id) {
    try {
      // Check cache first
      if (this.sessionIds.has(id)) {
        return this.sessionIds.get(id);
      }
      
      // Get from Column C
      const values = await this.sheetsService.getValues(`C${id}`);
      let sessionId = null;
      
      if (values && values[0] && values[0][0]) {
        sessionId = values[0][0].toString().trim();
        
        // Validate session ID format (should start with cs_)
        if (sessionId && !sessionId.startsWith('cs_')) {
          this.logger.warn(`Invalid session ID format for ID ${id}: ${sessionId}`);
        }
        
        // Cache for future use
        this.sessionIds.set(id, sessionId);
      } else {
        this.logger.warn(`No session ID found for appraisal ${id}`);
      }
      
      return sessionId;
    } catch (error) {
      this.logger.error(`Error retrieving session ID for appraisal ${id}:`, error);
      return null;
    }
  }

  async updateStatus(id, status, { sessionId } = {}) {
    try {
      this.logger.info(`Updating status for appraisal ${id} to: ${status}`, { sessionId });
      await this.sheetsService.updateValues(`F${id}`, [[status]]);
    } catch (error) {
      this.logger.error(`Error updating status for appraisal ${id}:`, error, { sessionId });
      // Don't throw here to prevent status updates from breaking the main flow
    }
  }

  async setAppraisalValue(id, value, description, { sessionId } = {}) {
    await this.sheetsService.updateValues(`J${id}:K${id}`, [[value, description]]);
    this.logger.info(`Set appraisal value for ${id}: $${value}`, { sessionId });
  }

  async mergeDescriptions(id, description, { sessionId } = {}) {
    const values = await this.sheetsService.getValues(`H${id}`);
    const iaDescription = values[0][0];
    this.logger.info(`Merging descriptions for appraisal ${id}`, { sessionId });
    const mergedDescription = await this.openaiService.mergeDescriptions(description, iaDescription);
    
    // Save merged description to Column L
    await this.sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
    this.logger.info(`Saved merged description for appraisal ${id}`, { sessionId });
    
    return mergedDescription;
  }

  async getAppraisalType(id, { sessionId } = {}) {
    const values = await this.sheetsService.getValues(`B${id}`);
    this.logger.info(`[DEBUG] Column B value type: ${typeof values?.[0]?.[0]}`, { sessionId });
    this.logger.info(`[DEBUG] Column B raw value: ${values?.[0]?.[0]}`, { sessionId });
    if (!values || !values[0] || !values[0][0]) {
      this.logger.warn(`No appraisal type found for ID ${id}, using default`, { sessionId });
      return 'Regular';
    }
    let appraisalType = values[0][0].toString();
    
    // Validate and normalize appraisal type
    const validTypes = ['Regular', 'IRS', 'Insurance'];
    if (!validTypes.includes(appraisalType)) {
      this.logger.warn(`Invalid appraisal type "${appraisalType}" found for ID ${id}, using default`, { sessionId });
      appraisalType = 'Regular';
    }
    
    this.logger.info(`[DEBUG] Processed appraisal type: ${appraisalType}`, { sessionId });
    return appraisalType;
  }

  async updateWordPress(id, value, mergedDescription, appraisalType, { sessionId } = {}) {
    try {
      const postId = await this.getWordPressPostId(id);
      
      if (!postId) {
        throw new Error(`No WordPress post ID found for appraisal ${id}`);
      }

      this.logger.info(`Updating WordPress post ${postId} for appraisal ${id}`, { sessionId });
      
      // Get the post title from column D
      const titleRow = await this.sheetsService.getValues(`D${id}`);
      const title = (titleRow && titleRow.length > 0 && titleRow[0].length > 0) ? 
        titleRow[0][0] : `Appraisal #${id}`;
      
      // Update the post with merged description and appraisal type
      const result = await this.wordpressService.updateAppraisalPost(
        postId, 
        {
          title,
          content: mergedDescription,
          value,
          appraisalType
        }
      );
      
      this.logger.info(`WordPress post ${postId} updated successfully`, { sessionId });
      
      // Get the public URL
      const publicUrl = result.link || result.publicUrl;
      
      // Save public URL to spreadsheet
      if (publicUrl) {
        await this.sheetsService.updateValues(`P${id}`, [[publicUrl]]);
        this.logger.info(`Saved public URL for appraisal ${id}: ${publicUrl}`, { sessionId });
      }
      
      // Complete the appraisal report
      try {
        this.logger.info(`Completing appraisal report for post ${postId}`, { sessionId });
        await this.wordpressService.completeAppraisalReport(postId);
      } catch (error) {
        // This is non-critical; the content was already saved
        this.logger.warn(`Failed to generate PDF report for appraisal ${id}, but content was saved: ${error.message}`, { sessionId });
      }
      
      return { 
        success: true,
        postId, 
        publicUrl 
      };
    } catch (error) {
      this.logger.error(`Error updating WordPress for appraisal ${id}:`, error, { sessionId });
      return { 
        success: false, 
        error 
      };
    }
  }

  async getWordPressPostId(id, { sessionId } = {}) {
    try {
      // First, try to get the post ID from column O (where it's expected)
      const valuesO = await this.sheetsService.getValues(`O${id}`);
      
      if (valuesO && valuesO[0] && valuesO[0][0]) {
        const postId = valuesO[0][0].toString().trim();
        
        if (postId && !isNaN(parseInt(postId))) {
          this.logger.info(`Found WordPress post ID in column O: ${postId}`, { sessionId });
          return postId;
        }
      }
      
      // If not found in column O, try column G (which might contain a WordPress URL)
      this.logger.info(`WordPress post ID not found in column O for appraisal ${id}, checking column G`, { sessionId });
      const valuesG = await this.sheetsService.getValues(`G${id}`);
      
      if (valuesG && valuesG[0] && valuesG[0][0]) {
        const wpUrlStr = valuesG[0][0].toString().trim();
        
        if (wpUrlStr) {
          this.logger.info(`Found value in column G: ${wpUrlStr}`, { sessionId });
          
          // Check if it's a URL containing post ID
          try {
            // The URL might be in format https://domain.com/wp-admin/post.php?post=123&action=edit
            // or https://domain.com/appraisals/123
            let postIdFromUrl = null;
            
            if (wpUrlStr.includes('post.php?post=')) {
              // Extract from admin URL
              const url = new URL(wpUrlStr);
              postIdFromUrl = url.searchParams.get('post');
            } else if (wpUrlStr.includes('/appraisals/')) {
              // Extract from frontend URL
              const urlPath = new URL(wpUrlStr).pathname;
              const matches = urlPath.match(/\/appraisals\/(\d+)/);
              if (matches && matches[1]) {
                postIdFromUrl = matches[1];
              }
            } else if (!isNaN(parseInt(wpUrlStr))) {
              // If it's just a number, use it directly
              postIdFromUrl = wpUrlStr;
            }
            
            if (postIdFromUrl && !isNaN(parseInt(postIdFromUrl))) {
              this.logger.info(`Extracted WordPress post ID from column G: ${postIdFromUrl}`, { sessionId });
              return postIdFromUrl;
            }
          } catch (urlError) {
            this.logger.warn(`Error parsing WordPress URL from column G: ${urlError.message}`, { sessionId });
          }
        }
      }
      
      // Finally, try column N as a fallback (some systems might use this column)
      this.logger.info(`WordPress post ID not found in columns O or G for appraisal ${id}, checking column N`, { sessionId });
      const valuesN = await this.sheetsService.getValues(`N${id}`);
      
      if (valuesN && valuesN[0] && valuesN[0][0]) {
        const potentialId = valuesN[0][0].toString().trim();
        
        if (potentialId && !isNaN(parseInt(potentialId))) {
          this.logger.info(`Found WordPress post ID in column N: ${potentialId}`, { sessionId });
          return potentialId;
        }
      }
      
      // No WordPress post ID found in any column
      this.logger.warn(`No WordPress post ID found for appraisal ${id} in columns O, G, or N`, { sessionId });
      return null;
    } catch (error) {
      this.logger.error(`Error retrieving WordPress post ID for appraisal ${id}:`, error, { sessionId });
      return null;
    }
  }

  async finalize(id, postId, publicUrl, { sessionId } = {}) {
    // Generate PDF
    const { pdfLink, docLink } = await this.pdfService.generatePDF(postId);
    await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]]);
    
    // Get customer data
    const customerData = await this.getCustomerData(id);
    
    // Send email notification and track delivery
    this.logger.info(`Sending completion email to ${customerData.email}`, { sessionId });
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
    
    this.logger.info(`Email delivery status saved for appraisal ${id}`, { sessionId });
  }

  async getCustomerData(id) {
    const values = await this.sheetsService.getValues(`D${id}:E${id}`);
    
    let email = 'NA';
    let name = 'NA';
    
    if (values && values[0] && values[0].length >= 2) {
      [email, name] = values[0];
      // If either value is empty, set it to 'NA'
      email = email || 'NA';
      name = name || 'NA';
    }

    this.logger.info(`Customer data for appraisal ${id}: email=${email}, name=${name}`);

    return {
      email,
      name
    };
  }

  async complete(id, { sessionId } = {}) {
    try {
      // Then move to completed sheet
      await this.sheetsService.moveToCompleted(id);
      
      this.logger.info(`Appraisal ${id} marked as complete and moved to Completed Appraisals`, { sessionId });
    } catch (error) {
      this.logger.error(`Error completing appraisal ${id}:`, error, { sessionId });
      throw error;
    }
  }
}

module.exports = AppraisalService;