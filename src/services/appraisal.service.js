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
      // Update initial status
      await this.updateStatus(id, 'Processing', 'Starting appraisal workflow');

      // Step 1: Set Value
      await this.updateStatus(id, 'Processing', 'Setting appraisal value');
      await this.setAppraisalValue(id, value, description);
      
      // Step 2: Merge Descriptions and Generate Titles
      await this.updateStatus(id, 'Analyzing', 'Merging descriptions and generating titles');
      const titleAndDescription = await this.mergeDescriptions(id, description);
      
      // Step 3: Get appraisal type from Column B
      await this.updateStatus(id, 'Analyzing', 'Determining appraisal type');
      const spreadsheetType = await this.getAppraisalType(id);
      // Use user provided type if available, otherwise use spreadsheet type
      const appraisalType = userProvidedType || spreadsheetType;
      this.logger.info(`Using appraisal type: ${appraisalType} (${userProvidedType ? 'from message' : 'from spreadsheet'})`);
      
      // Step 4: Update WordPress with type
      await this.updateStatus(id, 'Updating', 'Setting titles and metadata in WordPress');
      const { postId, publicUrl } = await this.updateWordPress(id, value, titleAndDescription, appraisalType);
      
      // Save public URL to spreadsheet
      await this.sheetsService.updateValues(`P${id}`, [[publicUrl]]);
      
      // Step 5: Complete Appraisal Report
      await this.updateStatus(id, 'Generating', 'Building full appraisal report');
      await this.wordpressService.completeAppraisalReport(postId);
      
      // Step 6: Generate PDF and Send Email
      await this.updateStatus(id, 'Finalizing', 'Creating PDF document');
      const pdfResult = await this.finalize(id, postId, publicUrl);
      await this.updateStatus(id, 'Finalizing', `PDF created: ${pdfResult.pdfLink}`);
      
      // Step 7: Mark as Complete
      await this.updateStatus(id, 'Completed', 'Appraisal process completed successfully');
      await this.complete(id);
      
      this.logger.info(`Successfully processed appraisal ${id}`);
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      await this.updateStatus(id, 'Failed', `Error: ${error.message}`);
      throw error;
    }
  }

  async updateStatus(id, status, details = null) {
    try {
      this.logger.info(`Updating status for appraisal ${id} to: ${status}${details ? ` (${details})` : ''}`);
      
      // Update status in column F
      await this.sheetsService.updateValues(`F${id}`, [[status]]);
      
      // If details are provided, add more context in column R (detailed status column)
      if (details) {
        const timestamp = new Date().toISOString();
        const statusDetails = `[${timestamp}] ${status}: ${details}`;
        
        try {
          // Get the existing detailed status log if any
          const existingDetails = await this.sheetsService.getValues(`R${id}`);
          let updatedDetails = statusDetails;
          
          if (existingDetails && existingDetails[0] && existingDetails[0][0]) {
            // Prepend new status to existing log (limited to last 5 status updates to avoid overflow)
            const detailsLog = existingDetails[0][0].split('\n');
            const recentDetails = [statusDetails, ...detailsLog.slice(0, 4)];
            updatedDetails = recentDetails.join('\n');
          }
          
          // Update the detailed status column
          await this.sheetsService.updateValues(`R${id}`, [[updatedDetails]]);
        } catch (detailsError) {
          this.logger.error(`Error updating status details for appraisal ${id}:`, detailsError);
        }
      }
      
      // Broadcast status update to WordPress
      try {
        // Get appraisal data for broadcasting
        const appraisalData = await this.sheetsService.getValues(`A${id}:G${id}`);
        
        if (appraisalData && appraisalData[0]) {
          const row = appraisalData[0];
          const metadata = { status_details: details || '' };
          
          // Update WordPress with detailed status
          const postUrl = row[6] || '';
          if (postUrl) {
            const url = new URL(postUrl);
            const postId = url.searchParams.get('post');
            
            if (postId) {
              try {
                await this.wordpressService.updateAppraisalPost(postId, {
                  status_progress: status,
                  status_details: details || '',
                  status_timestamp: new Date().toISOString()
                });
              } catch (wpError) {
                this.logger.error(`Error updating WordPress status for post ${postId}:`, wpError);
              }
            }
          }
        }
      } catch (broadcastError) {
        this.logger.error(`Error broadcasting status update for appraisal ${id}:`, broadcastError);
      }
    } catch (error) {
      this.logger.error(`Error updating status for appraisal ${id}:`, error);
      // Don't throw here to prevent status updates from breaking the main flow
    }
  }

  async setAppraisalValue(id, value, description) {
    await this.sheetsService.updateValues(`J${id}:K${id}`, [[value, description]]);
  }

  async mergeDescriptions(id, description) {
    const values = await this.sheetsService.getValues(`H${id}`);
    
    // Add null checking to prevent "Cannot read properties of undefined" error
    if (!values || !values[0] || values[0][0] === undefined) {
      this.logger.warn(`No AI description found in column H for appraisal ${id}, using fallback`);
      // Use empty string as fallback if no AI description is available
      const iaDescription = '';
      const result = await this.openaiService.mergeDescriptions(description || '', iaDescription);
      
      // Extract the components from the result
      const { mergedDescription, briefTitle, detailedTitle, metadata } = result;
      
      // Save merged description to Column L
      await this.sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
      
      // Log the titles and metadata for debugging
      this.logger.info(`Generated brief title: ${briefTitle}`);
      this.logger.info(`Generated detailed title length: ${detailedTitle.length} characters`);
      this.logger.info(`Metadata keys: ${Object.keys(metadata || {}).join(', ')}`);
      
      // Return all generated content
      return { 
        mergedDescription,
        briefTitle,
        detailedTitle,
        metadata
      };
    }
    
    const iaDescription = values[0][0];
    const result = await this.openaiService.mergeDescriptions(description || '', iaDescription);
    
    // Extract the components from the result
    const { mergedDescription, briefTitle, detailedTitle, metadata } = result;
    
    // Save merged description to Column L
    await this.sheetsService.updateValues(`L${id}`, [[mergedDescription]]);
    
    // Log the titles and metadata for debugging
    this.logger.info(`Generated brief title: ${briefTitle}`);
    this.logger.info(`Generated detailed title length: ${detailedTitle.length} characters`);
    this.logger.info(`Metadata keys: ${Object.keys(metadata || {}).join(', ')}`);
    
    // Return all generated content
    return { 
      mergedDescription,
      briefTitle,
      detailedTitle,
      metadata
    };
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
    
    // Check if mergedDescription is a string or an object with the new structure
    let briefTitle, detailedTitle, description, metadata;
    
    if (typeof mergedDescription === 'object') {
      // New structure with brief and detailed titles
      briefTitle = mergedDescription.briefTitle;
      detailedTitle = mergedDescription.detailedTitle;
      description = mergedDescription.mergedDescription;
      metadata = mergedDescription.metadata || {};
    } else {
      // Legacy format (just a string)
      // Don't truncate the title if it's the only one we have
      briefTitle = mergedDescription;
      detailedTitle = mergedDescription;
      description = mergedDescription;
      metadata = {};
    }
    
    // Ensure the brief title doesn't appear truncated in the UI
    if (!briefTitle || briefTitle.endsWith('...')) {
      // Extract a good title from the detailed title if possible
      if (detailedTitle && detailedTitle.length > 3) {
        // Take first sentence or a reasonable chunk
        briefTitle = detailedTitle.split('.')[0];
        if (briefTitle.length > 80) {
          briefTitle = briefTitle.substring(0, 80).trim() + '...';
        }
      }
    }
    
    // If brief title is still missing or too short, extract from description
    if (!briefTitle || briefTitle.length < 10) {
      briefTitle = description && description.length > 10 
        ? description.substring(0, 80).trim() + (description.length > 80 ? '...' : '')
        : 'Artwork Appraisal';
      
      this.logger.info(`Generated fallback title: ${briefTitle}`);
    }
    
    // Extract additional metadata from appraisal data if metadata doesn't have all fields
    // Only do this if we don't already have metadata from OpenAI
    if (!metadata || Object.keys(metadata).length === 0) {
      // Get the data from columns H (IA description) and L (merged description) to extract potential metadata
      const [iaValues, mergedValues] = await Promise.all([
        this.sheetsService.getValues(`H${id}`),
        this.sheetsService.getValues(`L${id}`)
      ]);
      
      // Extract metadata using regex patterns from descriptions
      const iaDescription = iaValues?.[0]?.[0] || '';
      const mergedDescriptionText = mergedValues?.[0]?.[0] || '';
      const allText = iaDescription + ' ' + mergedDescriptionText + ' ' + detailedTitle;
      
      // Extract potential metadata using regex patterns
      metadata = {
        object_type: this.extractMetadata(allText, /(?:object type|artwork type|item type)[:\s]+([^,.;]+)/i),
        creator: this.extractMetadata(allText, /(?:by|artist|creator)[:\s]+([^,.;]+)/i),
        estimated_age: this.extractMetadata(allText, /(?:created|circa|dates from|period|age)[:\s]+([^,.;]+)/i),
        medium: this.extractMetadata(allText, /(?:medium|materials|created with|made of)[:\s]+([^,.;]+)/i),
        condition_summary: this.extractMetadata(allText, /(?:condition|state)[:\s]+([^,.;]+)/i)
      };
      
      // Log extracted metadata
      this.logger.info(`Extracted metadata from descriptions:`, metadata);
    } else {
      this.logger.info(`Using structured metadata from OpenAI:`, metadata);
    }
    
    // Log final title selection
    this.logger.info(`Using brief title: "${briefTitle}"`);
    this.logger.info(`Using detailed title (first 50 chars): "${detailedTitle.substring(0, 50)}..."`);
    
    const updatedPost = await this.wordpressService.updateAppraisalPost(postId, {
      title: briefTitle,
      content: post.content?.rendered || '',
      value: value.toString(),
      appraisalType: appraisalType,
      detailedTitle: detailedTitle,
      // Add extracted metadata
      object_type: metadata.object_type,
      creator: metadata.creator,
      estimated_age: metadata.estimated_age,
      medium: metadata.medium,
      condition_summary: metadata.condition_summary
    });

    return {
      postId,
      publicUrl: updatedPost.publicUrl
    };
  }

  // Helper function to extract metadata using regex
  extractMetadata(text, pattern) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
    return null;
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
    this.logger.info(`Generating PDF for appraisal ${id} (postId: ${postId})`);
    const { pdfLink, docLink } = await this.pdfService.generatePDF(postId);
    await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]]);
    this.logger.info(`PDF generated successfully: ${pdfLink}`);
    
    // Get customer data
    this.logger.info(`Retrieving customer data for appraisal ${id}`);
    const customerData = await this.getCustomerData(id);
    
    // Send email notification and track delivery
    this.logger.info(`Sending completion email to ${customerData.email}`);
    await this.updateStatus(id, 'Finalizing', `Sending email notification to ${customerData.email}`);
    
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
    
    return { pdfLink, docLink, emailResult };
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

  async complete(id) {
    try {
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