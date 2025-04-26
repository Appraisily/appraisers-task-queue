const { createLogger } = require('../utils/logger');
const AppraisalFinder = require('../utils/appraisal-finder');
const fetch = require('node-fetch');

class AppraisalService {
  constructor(sheetsService, wordpressService, openaiService, emailService, pdfService) {
    this.logger = createLogger('AppraisalService');
    this.sheetsService = sheetsService;
    this.wordpressService = wordpressService;
    this.openaiService = openaiService;
    this.emailService = emailService;
    this.pdfService = pdfService;
    this.appraisalFinder = new AppraisalFinder(sheetsService);
  }

  async processAppraisal(id, value, description, appraisalType = 'Regular', usingCompletedSheet = null) {
    try {
      // Skip sheet determination if usingCompletedSheet is provided as parameter
      if (usingCompletedSheet === null) {
        // Only check sheet if not explicitly provided
        const existenceCheck = await this.appraisalFinder.appraisalExists(id);
        if (!existenceCheck.exists) {
          throw new Error(`Appraisal ${id} not found in either pending or completed sheets`);
        }
        usingCompletedSheet = existenceCheck.usingCompletedSheet;
      }
      
      this.logger.info(`Processing appraisal ${id} (value: ${value}, type: ${appraisalType}) using ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      
      // Update status (keep this - it's important to set the initial status)
      await this.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheet);
      
      // Skip value formatting and J column update since value from sheets is already correctly formatted
      // The input value will be used as-is for WordPress updates later
      
      // Update status
      await this.updateStatus(id, 'Processing', 'Merging description with AI analysis', usingCompletedSheet);
      
      // Merge descriptions - pass along which sheet to use
      const mergeResult = await this.mergeDescriptions(id, description, usingCompletedSheet);
      
      // Update WordPress with the raw value (no formatting needed)
      // Pass the mergeResult object instead of the original description
      const { postId, publicUrl, usingCompletedSheet: wpUsingCompletedSheet } = await this.updateWordPress(id, value, mergeResult, appraisalType, usingCompletedSheet);
      
      // Store public URL
      await this.sheetsService.updateValues(`P${id}`, [[publicUrl]], wpUsingCompletedSheet);
      
      // Generate complete appraisal report (which includes visualizations, statistics, etc.)
      await this.updateStatus(id, 'Generating', 'Building complete appraisal report', wpUsingCompletedSheet);
      await this.visualize(id, postId, wpUsingCompletedSheet);
      
      // Create PDF
      await this.updateStatus(id, 'Finalizing', 'Creating PDF document', wpUsingCompletedSheet);
      const pdfResult = await this.finalize(id, postId, publicUrl, wpUsingCompletedSheet);
      await this.updateStatus(id, 'Finalizing', `PDF created: ${pdfResult.pdfLink}`, wpUsingCompletedSheet);
      
      // Mark as complete only if not from completed sheet
      if (!usingCompletedSheet) {
        await this.complete(id);
      }
      
      this.logger.info(`Appraisal ${id} processing completed`);
      return { success: true, message: 'Appraisal processed successfully' };
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      await this.updateStatus(id, 'Failed', `Error: ${error.message}`, usingCompletedSheet);
      throw error;
    }
  }

  async updateStatus(id, status, details = null, useCompletedSheet = false) {
    try {
      this.logger.info(`Updating status for appraisal ${id} to: ${status}${details ? ` (${details})` : ''}`);
      
      // Check if we should skip the sheet update for this status
      const skipSheetUpdate = status === 'Generating';
      
      if (skipSheetUpdate) {
        this.logger.info(`Skipping sheet status update for '${status}' phase (internal tracking only)`);
        // We still log the status change for internal tracking but don't modify the sheet
        return;
      }
      
      // Update status in column F (status column) through SheetsService
      // SheetsService should only handle the data operation without any business logic
      await this.sheetsService.updateValues(`F${id}`, [[status]], useCompletedSheet);
      
      // If we have details, we could store them in a tracking log or application database
      // But we've removed the column R detailed status log as per previous comment
      
      return { success: true, status };
    } catch (error) {
      this.logger.error(`Error updating status for appraisal ${id}:`, error);
      // Don't throw here to prevent status updates from breaking the main flow
      return { success: false, error: error.message };
    }
  }

  async setAppraisalValue(id, value, description) {
    await this.sheetsService.updateValues(`J${id}:K${id}`, [[value, description]]);
  }

  async mergeDescriptions(id, description, useCompletedSheet = false) {
    // Get AI description from column H
    const aiDescValues = await this.sheetsService.getValues(`H${id}`, useCompletedSheet);
    let iaDescription = '';
    
    // Add null checking to prevent "Cannot read properties of undefined" error
    if (aiDescValues && aiDescValues[0] && aiDescValues[0][0] !== undefined) {
      iaDescription = aiDescValues[0][0];
    } else {
      this.logger.warn(`No AI description found in column H for appraisal ${id}, using empty string`);
    }
    
    // Ensure we have a valid description to merge (customer provided)
    const customerDescription = description || '';
    
    // Use OpenAI service to make the API call - this now only returns the raw response
    const openaiResponse = await this.openaiService.mergeDescriptions(customerDescription, iaDescription);
    
    // Apply additional processing and validation here in the AppraisalService
    // Extract the components from the raw response
    const { mergedDescription, briefTitle } = openaiResponse;
    
    if (!mergedDescription) {
      this.logger.warn(`Missing mergedDescription in OpenAI response for appraisal ${id}`);
    }
    
    // Create the complete response with required fields
    const result = {
      mergedDescription: mergedDescription || 'Error generating description.',
      briefTitle: briefTitle || 'Artwork Appraisal',
      // Set detailedTitle to be the same as mergedDescription
      detailedTitle: mergedDescription || 'Error generating description.'
    };
    
    // Save merged description to Column L, using the correct sheet
    await this.sheetsService.updateValues(`L${id}`, [[result.mergedDescription]], useCompletedSheet);
    
    this.logger.info(`Generated and saved merged description for appraisal ${id}`);
    
    // Return all generated content
    return result;
  }

  async getAppraisalType(id) {
    try {
      const { data, usingCompletedSheet } = await this.appraisalFinder.findAppraisalData(id, `B${id}`);
      
      if (!data || !data[0] || !data[0][0]) {
        this.logger.warn(`No appraisal type found for ID ${id}, using default`);
        return 'Regular';
      }
      
      let appraisalType = data[0][0].toString();
      
      // Validate and normalize appraisal type
      const validTypes = ['Regular', 'IRS', 'Insurance'];
      if (!validTypes.includes(appraisalType)) {
        this.logger.warn(`Invalid appraisal type "${appraisalType}" found for ID ${id}, using default`);
        appraisalType = 'Regular';
      }
      
      this.logger.info(`Appraisal type for ID ${id}: ${appraisalType}`);
      return appraisalType;
    } catch (error) {
      this.logger.error(`Error getting appraisal type for ${id}:`, error);
      return 'Regular'; // Default fallback
    }
  }

  async updateWordPress(id, value, mergedDescriptionObj, appraisalType, usingCompletedSheet = false) {
    // Pass the usingCompletedSheet parameter to getWordPressPostId
    const { postId } = await this.getWordPressPostId(id, usingCompletedSheet);
    
    const post = await this.wordpressService.getPost(postId);
    
    // Validate and format the value
    let safeValue = value;
    
    if (typeof value === 'object' && value !== null) {
      if (value.then && typeof value.then === 'function') {
        // This is a Promise object - this happens sometimes due to improper Promise handling
        this.logger.warn(`Value for appraisal ${id} is a Promise object, converting to error string`);
        safeValue = '[Error: Invalid value format]';
      } else if (JSON.stringify(value) === '{}') {
        // Empty object
        this.logger.warn(`Value for appraisal ${id} is an empty object, using default value`);
        safeValue = 0;
      } else {
        // Try to extract a value property or convert to string
        safeValue = value.value || value.toString() || 0;
      }
    } else if (value === undefined || value === null) {
      safeValue = 0;
    }
    
    this.logger.info(`Updating WordPress post ${postId} with value: ${safeValue}, type: ${appraisalType || 'Regular'}`);
    
    // Process different formats of mergedDescription
    let briefTitle = '';
    let detailedTitle = '';
    let description = '';
    
    if (typeof mergedDescriptionObj === 'object' && mergedDescriptionObj !== null && !Array.isArray(mergedDescriptionObj)) {
      // New structure with brief and detailed titles
      briefTitle = mergedDescriptionObj.briefTitle;
      detailedTitle = mergedDescriptionObj.detailedTitle || mergedDescriptionObj.mergedDescription;
      description = mergedDescriptionObj.mergedDescription;
    } else {
      // Legacy format (just a string)
      // Don't truncate the title if it's the only one we have
      briefTitle = mergedDescriptionObj;
      detailedTitle = mergedDescriptionObj;
      description = mergedDescriptionObj;
      this.logger.warn(`Legacy format detected for appraisal ${id}: using string value for all fields`);
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
    
    // Log final selections
    this.logger.info(`Using brief title for post title and detailedTitle field (${detailedTitle?.length || 0} chars)`);
    
    // Check for potential issues with detailedTitle
    if (detailedTitle) {
      if (typeof detailedTitle !== 'string') {
        this.logger.error(`ERROR: detailedTitle is not a string but a ${typeof detailedTitle}`);
        detailedTitle = String(detailedTitle);
      }
      
      if (detailedTitle.length === 0) {
        this.logger.warn(`WARNING: detailedTitle is an empty string`);
      }
      
      if (detailedTitle.length > 10000) {
        this.logger.warn(`WARNING: detailedTitle is very long (${detailedTitle.length} chars) - may exceed WordPress limits`);
      }
    } else {
      this.logger.warn(`WARNING: detailedTitle is null or undefined before WordPress update`);
    }
    
    // Simplified WordPress update with only essential fields
    const updatedPost = await this.wordpressService.updateAppraisalPost(postId, {
      title: briefTitle,
      content: post.content?.rendered || '',
      value: safeValue, // Use safely formatted value
      appraisalType: appraisalType,
      detailedTitle: detailedTitle // This will be mapped to 'detailedtitle' in the WordPress service
    });

    return {
      postId,
      publicUrl: updatedPost.publicUrl,
      usingCompletedSheet
    };
  }

  async getWordPressPostId(id, usingCompletedSheet = false) {
    try {
      // Use the provided sheet information instead of finding it again
      this.logger.info(`Getting WordPress post ID for appraisal ${id} from ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      
      // Get the WordPress URL directly from the specified sheet
      const data = await this.sheetsService.getValues(`G${id}`, usingCompletedSheet);
      
      if (!data || !data[0] || !data[0][0]) {
        throw new Error(`No WordPress URL found for appraisal ${id} in ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      }

      const wpUrl = data[0][0];
      const url = new URL(wpUrl);
      const postId = url.searchParams.get('post');
      
      if (!postId) {
        throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
      }

      this.logger.info(`Extracted WordPress post ID: ${postId} from URL: ${wpUrl}`);
      
      return {
        postId,
        usingCompletedSheet
      };
    } catch (error) {
      this.logger.error(`Error getting WordPress post ID for appraisal ${id}:`, error);
      throw error;
    }
  }

  async visualize(id, postId, usingCompletedSheet = false) {
    try {
      this.logger.info(`Generating complete appraisal report for appraisal ${id} (WordPress post ID: ${postId})`);
      
      // Update status - internal logging only, no sheet updates for 'Generating'
      await this.updateStatus(id, 'Generating', 'Building complete appraisal report', usingCompletedSheet);
      
      // Use runtime environment variable for backend URL
      let appraisalsBackendUrl = process.env.APPRAISALS_BACKEND_URL;
      
      // Fallback value if the runtime variable is not set
      if (!appraisalsBackendUrl) {
        this.logger.warn('APPRAISALS_BACKEND_URL runtime variable not found, using fallback URL');
        appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
      }
      
      // Directly call the backend API to generate the complete appraisal report
      // This performs all steps: Vision API image processing, metadata processing,
      // statistics generation, and visualization generation in a single call
      const response = await fetch(`${appraisalsBackendUrl}/complete-appraisal-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.wordpressService.authHeader
        },
        body: JSON.stringify({ postId: postId })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Report generation failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      this.logger.info(`Successfully generated complete appraisal report for post ${postId}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error generating complete appraisal report for appraisal ${id}:`, error);
      // For errors, we still want to update the status - this will update the sheet
      await this.updateStatus(id, 'Error', `Failed to generate report: ${error.message}`, usingCompletedSheet);
      throw error;
    }
  }

  async finalize(id, postId, publicUrl, usingCompletedSheet = false) {
    try {
      this.logger.info(`Finalizing appraisal ${id} (post ID: ${postId}) using ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      
      // Generate PDF with proper waiting
      const { pdfLink, docLink } = await this.pdfService.generatePDF(postId);
      
      // Validate PDF URL - don't proceed with placeholders or invalid URLs
      if (!pdfLink || pdfLink.includes('placeholder') || !docLink || docLink.includes('placeholder')) {
        throw new Error(`Invalid PDF URLs received: ${pdfLink}`);
      }
      
      // Save PDF links to Google Sheets
      this.logger.info(`Saving PDF links to ${usingCompletedSheet ? 'Completed' : 'Pending'} Appraisals sheet`);
      await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]], usingCompletedSheet);
      this.logger.info(`PDF generated successfully: ${pdfLink}`);
      
      // Get customer data directly using the known sheet information
      this.logger.info(`Retrieving customer data for appraisal ${id} from ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      const customerData = await this.getCustomerData(id, usingCompletedSheet);
      this.logger.info(`Customer data for appraisal ${id}: email=${customerData.email}, name=${customerData.name}`);
      
      // Only send email if we have a valid PDF URL
      if (pdfLink && !pdfLink.includes('placeholder')) {
        // Send email notification and track delivery
        this.logger.info(`Sending completion email to ${customerData.email}`);
        await this.updateStatus(id, 'Finalizing', `Sending email notification to ${customerData.email}`, usingCompletedSheet);
        
        const emailResult = await this.emailService.sendAppraisalCompletedEmail(
          customerData.email,
          customerData.name,
          { 
            pdfLink: pdfLink,
            appraisalUrl: publicUrl
          }
        );

        // Save email delivery status to Column Q
        const emailStatus = `Email sent on ${emailResult.timestamp} (ID: ${emailResult.messageId || 'success'})`;
        await this.sheetsService.updateValues(`Q${id}`, [[emailStatus]], usingCompletedSheet);
        
        this.logger.info(`Email delivery status saved for appraisal ${id}`);
      } else {
        this.logger.warn(`Skipping email for appraisal ${id} due to invalid PDF URL`);
        await this.updateStatus(id, 'Warning', `Email not sent - invalid PDF URL`, usingCompletedSheet);
      }
      
      return { pdfLink, docLink, emailResult: {} };
    } catch (error) {
      this.logger.error(`Error finalizing appraisal ${id}:`, error);
      await this.updateStatus(id, 'Failed', `PDF generation failed: ${error.message}`, usingCompletedSheet);
      throw error;
    }
  }

  /**
   * Get customer email and name directly from the specified sheet
   * @param {string|number} id - Appraisal ID
   * @param {boolean} usingCompletedSheet - Which sheet to check
   * @returns {Promise<{email: string, name: string}>} - Customer data 
   */
  async getCustomerData(id, usingCompletedSheet = false) {
    try {
      // Get columns D and E directly from the specified sheet
      const data = await this.sheetsService.getValues(`D${id}:E${id}`, usingCompletedSheet);
      
      let email = 'NA';
      let name = 'NA';
      
      if (data && data[0] && data[0].length >= 2) {
        [email, name] = data[0];
        // If either value is empty, set it to 'NA'
        email = email || 'NA';
        name = name || 'NA';
      }
      
      return { email, name };
    } catch (error) {
      this.logger.error(`Error fetching customer data for appraisal ${id}:`, error);
      // Return default values in case of error
      return { email: 'NA', name: 'NA' };
    }
  }

  async complete(id) {
    try {
      // Mark as complete
      await this.updateStatus(id, 'Completed', 'Appraisal process completed successfully');
      
      // Then move to completed sheet
      await this.sheetsService.moveToCompleted(id);
      
      this.logger.info(`Appraisal ${id} marked as complete and moved to Completed Appraisals`);
    } catch (error) {
      this.logger.error(`Error completing appraisal ${id}:`, error);
      throw error;
    }
  }

  async formatAppraisalValue(value) {
    // Ensure value is a number or numeric string
    if (value === null || value === undefined) {
      return '0';
    }
    
    // Convert to string if it's not already
    let stringValue = String(value).trim();
    
    // If it begins with a currency symbol, remove it
    stringValue = stringValue.replace(/^[$€£¥]/, '');
    
    // Remove any commas that might be present for thousands
    stringValue = stringValue.replace(/,/g, '');
    
    // Try to parse as a number, defaulting to 0 if it fails
    let numValue;
    try {
      numValue = parseFloat(stringValue);
      // Check if numValue is NaN (Not a Number)
      if (isNaN(numValue)) {
        numValue = 0;
      }
    } catch (error) {
      this.logger.error(`Error parsing value "${stringValue}":`, error);
      numValue = 0;
    }
    
    // Always return a string, never an object
    const result = numValue.toString();
    this.logger.info(`Formatted appraisal value: "${value}" -> "${result}"`);
    return result;
  }
}

module.exports = AppraisalService;