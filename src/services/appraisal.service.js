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
    // Track important status events to avoid duplication
    this.statusEvents = new Map();
  }

  /**
   * Process an appraisal from start to finish
   * @param {string|number} id - Appraisal ID
   * @param {string|number} value - Appraisal value
   * @param {string} description - Customer description
   * @param {string} appraisalType - Appraisal type (Regular, Insurance, IRS)
   * @param {boolean|null} usingCompletedSheet - Which sheet to use, or null to skip all sheet operations
   * @returns {Promise<object>} - Result
   */
  async processAppraisal(id, value, description, appraisalType = 'Regular', usingCompletedSheet = null) {
    try {
      // Check if sheet operations should be skipped
      const skipSheetOperations = usingCompletedSheet === null;
      
      if (!skipSheetOperations) {
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
        
        // Explicitly save value to column J and appraisal type to column B
        await this.sheetsService.updateValues(`J${id}`, [[value]], usingCompletedSheet);
        await this.sheetsService.updateValues(`B${id}`, [[appraisalType]], usingCompletedSheet);
        this.logger.info(`Saved appraisal value ${value} to column J and type ${appraisalType} to column B`);
      } else {
        this.logger.info(`Processing appraisal ${id} (value: ${value}, type: ${appraisalType}) - skipping sheet operations`);
      }
      
      // Get WordPress Post ID early - needed for potentially generating AI description
      let postId;
      
      if (!skipSheetOperations) {
        const { postId: fetchedPostId } = await this.getWordPressPostId(id, usingCompletedSheet);
        postId = fetchedPostId;
      } else {
        // Try to extract postId from options if provided
        postId = id; // Fallback to using the appraisal ID as the post ID
        this.logger.warn(`Sheet operations skipped - using ${postId} as WordPress post ID`);
      }
      
      // Skip value formatting and J column update since value from sheets is already correctly formatted
      // The input value will be used as-is for WordPress updates later
      
      // Merge descriptions - pass along which sheet to use AND the postId
      const mergeResult = await this.mergeDescriptions(id, description, postId, skipSheetOperations ? null : usingCompletedSheet);
      
      // Update WordPress with the raw value (no formatting needed)
      // Pass the mergeResult object instead of the original description
      const { publicUrl, usingCompletedSheet: wpUsingCompletedSheet } = await this.updateWordPress(id, value, mergeResult, appraisalType, skipSheetOperations ? null : usingCompletedSheet, postId);
      
      // Store public URL if not skipping sheet operations
      if (!skipSheetOperations) {
        await this.sheetsService.updateValues(`P${id}`, [[publicUrl]], wpUsingCompletedSheet);
      }

      // Apply WordPress template pattern before generating report
      await this.applyWordPressTemplate(id, postId, skipSheetOperations ? null : wpUsingCompletedSheet);
      
      // Generate complete appraisal report (which includes visualizations, statistics, etc.)
      if (!skipSheetOperations) {
        await this.updateStatus(id, 'Generating', 'Building complete appraisal report', wpUsingCompletedSheet);
      }
      await this.visualize(id, postId, skipSheetOperations ? null : wpUsingCompletedSheet);
      
      // Create PDF
      if (!skipSheetOperations) {
        await this.updateStatus(id, 'Finalizing', 'Creating PDF document', wpUsingCompletedSheet);
      }
      const pdfResult = await this.finalize(id, postId, publicUrl, skipSheetOperations ? null : wpUsingCompletedSheet);
      
      // Mark as complete only if not from completed sheet and not skipping sheet operations
      if (!skipSheetOperations && !usingCompletedSheet) {
        await this.complete(id);
      }
      
      this.logger.info(`Appraisal ${id} processing completed`);
      return { success: true, message: 'Appraisal processed successfully' };
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id}:`, error);
      if (!skipSheetOperations) {
        await this.updateStatus(id, 'Failed', `Error: ${error.message}`, usingCompletedSheet);
      }
      throw error;
    }
  }

  async updateStatus(id, status, details = null, useCompletedSheet = false) {
    try {
      // Skip sheet operations if useCompletedSheet is null
      if (useCompletedSheet === null) {
        this.logger.debug(`[Skip] Status update: ${id} -> ${status}${details ? ` (${details})` : ''}`);
        return { success: true, status, skipped: true };
      }
      
      // Create a key to avoid duplicate status updates for the same appraisal/status
      const statusKey = `${id}:${status}`;
      const now = Date.now();
      const lastUpdate = this.statusEvents.get(statusKey) || 0;
      
      // Only log status changes that haven't happened in the last 5 seconds
      if (now - lastUpdate > 5000) {
        this.logger.debug(`Status update: ${id} -> ${status}${details ? ` (${details})` : ''}`);
        this.statusEvents.set(statusKey, now);
      }
      
      // Check if we should skip the sheet update for this status
      const skipSheetUpdate = status === 'Generating';
      
      if (skipSheetUpdate) {
        // Skip sheet updates for generating status
        return { success: true, status, skipped: true };
      }
      
      // Update status in column F (status column) through SheetsService
      await this.sheetsService.updateValues(`F${id}`, [[status]], useCompletedSheet);
      
      return { success: true, status };
    } catch (error) {
      this.logger.error(`Error updating status for appraisal ${id}:`, error);
      // Don't throw here to prevent status updates from breaking the main flow
      return { success: false, error: error.message };
    }
  }

  async setAppraisalValue(id, value, description, appraisalType = null, useCompletedSheet = false) {
    // Save value and description to columns J and K
    await this.sheetsService.updateValues(`J${id}:K${id}`, [[value, description]], useCompletedSheet);
    
    // If appraisal type is provided, save it to column B
    if (appraisalType) {
      await this.sheetsService.updateValues(`B${id}`, [[appraisalType]], useCompletedSheet);
      this.logger.debug(`Updated appraisal type ${appraisalType} in column B for appraisal ${id}`);
    }
  }

  async mergeDescriptions(id, description, postId, useCompletedSheet = false) {
    // Skip sheet operations if useCompletedSheet is null
    const skipSheetOperations = useCompletedSheet === null;
    
    // Get AI description from column H
    let iaDescription = '';
    
    if (!skipSheetOperations) {
      const aiDescValues = await this.sheetsService.getValues(`H${id}`, useCompletedSheet);
      
      // Add null checking to prevent "Cannot read properties of undefined" error
      if (aiDescValues && aiDescValues[0] && aiDescValues[0][0]) {
        iaDescription = aiDescValues[0][0];
        this.logger.debug(`Found existing AI description for appraisal ${id}`);
      } else {
        this.logger.debug(`No AI description found for appraisal ${id}. Generating one.`);
        try {
          // 1. Get WordPress post data to find the featured image ID
          const postData = await this.wordpressService.getPost(postId);
          const featuredMediaId = postData?.featured_media; // Assumes featured_media holds the ID

          if (featuredMediaId) {
             // 2. Get the image URL from the media ID
             const imageUrl = await this.wordpressService.getImageUrl(featuredMediaId);
             
             if (imageUrl) {
               // 3. Call OpenAI to generate the description
               const generationPrompt = `Analyze this image of an artwork or antique. Provide a detailed description covering aspects like style, period, materials, condition, subject matter, and potential artist or origin. Focus on objective observations.`;
               iaDescription = await this.openaiService.analyzeImageWithGPT4o(imageUrl, generationPrompt);
               
               // 4. Save the newly generated description back to column H
               await this.sheetsService.updateValues(`H${id}`, [[iaDescription]], useCompletedSheet);
             } else {
               this.logger.warn(`Could not retrieve image URL for media ID ${featuredMediaId}`);
               iaDescription = ''; // Ensure it's empty if generation failed
             }
          } else {
            this.logger.warn(`No featured media ID found for post ${postId}`);
            iaDescription = ''; // Ensure it's empty if generation failed
          }
        } catch (genError) {
          this.logger.error(`Error during AI description generation:`, genError);
          iaDescription = ''; // Ensure it's empty if generation failed
        }
      }
    } else {
      this.logger.debug(`Skipping sheet operations for AI description, using empty iaDescription`);
    }
    
    // Ensure we have a valid description to merge (customer provided)
    const customerDescription = description || '';
    
    this.logger.debug(`Calling OpenAI to merge descriptions`);
    // Use OpenAI service to make the API call - this now only returns the raw response
    const openaiResponse = await this.openaiService.mergeDescriptions(customerDescription, iaDescription);
    
    // Apply additional processing and validation here in the AppraisalService
    // Extract the components from the raw response
    const { mergedDescription, briefTitle } = openaiResponse;
    
    if (!mergedDescription) {
      this.logger.warn(`Missing mergedDescription in OpenAI response`);
    }
    
    // Create the complete response with required fields
    const result = {
      mergedDescription: mergedDescription || 'Error generating description.',
      briefTitle: briefTitle || 'Artwork Appraisal',
      // Set detailedTitle to be the same as mergedDescription
      detailedTitle: mergedDescription || 'Error generating description.'
    };
    
    // Save merged description to Column L, using the correct sheet
    if (!skipSheetOperations) {
      await this.sheetsService.updateValues(`L${id}`, [[result.mergedDescription]], useCompletedSheet);
      this.logger.debug(`Generated and saved merged description`);
    } else {
      this.logger.debug(`Generated merged description (sheet update skipped)`);
    }
    
    // Return all generated content
    return result;
  }

  async getAppraisalType(id) {
    try {
      const { data, usingCompletedSheet } = await this.appraisalFinder.findAppraisalData(id, `B${id}`);
      
      if (!data || !data[0] || !data[0][0]) {
        this.logger.debug(`No appraisal type found for ID ${id}, using default`);
        return 'Regular';
      }
      
      let appraisalType = data[0][0].toString();
      
      // Validate and normalize appraisal type
      const validTypes = ['Regular', 'IRS', 'Insurance'];
      if (!validTypes.includes(appraisalType)) {
        this.logger.debug(`Invalid appraisal type "${appraisalType}" found for ID ${id}, using default`);
        appraisalType = 'Regular';
      }
      
      return appraisalType;
    } catch (error) {
      this.logger.error(`Error getting appraisal type:`, error);
      return 'Regular'; // Default fallback
    }
  }

  async updateWordPress(id, value, mergedDescriptionObj, appraisalType, usingCompletedSheet = false, postId = null) {
    // Pass the usingCompletedSheet parameter to getWordPressPostId only if postId is not provided
    if (!postId) {
       const { postId: fetchedPostId } = await this.getWordPressPostId(id, usingCompletedSheet);
       postId = fetchedPostId; // Assign the fetched postId
    }
    
    const post = await this.wordpressService.getPost(postId);
    
    // Validate and format the value
    let safeValue = value;
    
    if (typeof value === 'object' && value !== null) {
      if (value.then && typeof value.then === 'function') {
        // This is a Promise object - this happens sometimes due to improper Promise handling
        this.logger.warn(`Value for appraisal ${id} is a Promise object`);
        safeValue = '[Error: Invalid value format]';
      } else if (JSON.stringify(value) === '{}') {
        // Empty object
        this.logger.warn(`Value for appraisal ${id} is an empty object`);
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
      this.logger.debug(`Legacy format detected: using string value for all fields`);
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
      // Get the WordPress URL directly from the specified sheet
      const data = await this.sheetsService.getValues(`G${id}`, usingCompletedSheet);
      
      if (!data || !data[0] || !data[0][0]) {
        throw new Error(`No WordPress URL found for appraisal ${id}`);
      }

      const wpUrl = data[0][0];
      const url = new URL(wpUrl);
      const postId = url.searchParams.get('post');
      
      if (!postId) {
        throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
      }

      this.logger.debug(`Extracted WordPress post ID: ${postId}`);
      
      return {
        postId,
        usingCompletedSheet
      };
    } catch (error) {
      this.logger.error(`Error getting WordPress post ID:`, error);
      throw error;
    }
  }

  async visualize(id, postId, usingCompletedSheet = false) {
    try {
      this.logger.info(`Generating appraisal report for post ID: ${postId}`);
      
      // Use runtime environment variable for backend URL
      let appraisalsBackendUrl = process.env.APPRAISALS_BACKEND_URL;
      
      // Fallback value if the runtime variable is not set
      if (!appraisalsBackendUrl) {
        this.logger.warn('APPRAISALS_BACKEND_URL runtime variable not found, using fallback URL');
        appraisalsBackendUrl = 'https://appraisals-backend-856401495068.us-central1.run.app';
      }
      
      // Set up AbortController with a 30-minute timeout (1800000ms)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 minute timeout
      
      try {
        // Directly call the backend API to generate the complete appraisal report
        const response = await fetch(`${appraisalsBackendUrl}/complete-appraisal-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.wordpressService.authHeader
          },
          body: JSON.stringify({ postId: postId }),
          signal: controller.signal
        });
        
        // Clear the timeout when the response is received
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Report generation failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        this.logger.debug(`Generated report for post ${postId}`);
        
        return { success: true };
      } catch (fetchError) {
        // Clear timeout on error to prevent memory leaks
        clearTimeout(timeoutId);
        throw fetchError; // Rethrow to be caught by the outer try/catch
      }
    } catch (error) {
      this.logger.error(`Error generating report:`, error);
      // For errors, we still want to update the status - this will update the sheet
      await this.updateStatus(id, 'Error', `Failed to generate report`, usingCompletedSheet);
      throw error;
    }
  }

  async finalize(id, postId, publicUrl, usingCompletedSheet = false) {
    try {
      // Generate PDF with proper waiting
      const { pdfLink, docLink } = await this.pdfService.generatePDF(postId);
      
      // Validate PDF URL - don't proceed with placeholders or invalid URLs
      if (!pdfLink || pdfLink.includes('placeholder') || !docLink || docLink.includes('placeholder')) {
        throw new Error(`Invalid PDF URLs received: ${pdfLink}`);
      }
      
      // Save PDF links to Google Sheets
      await this.sheetsService.updateValues(`M${id}:N${id}`, [[pdfLink, docLink]], usingCompletedSheet);
      this.logger.info(`PDF generated: ${pdfLink}`);
      
      // Get customer data directly using the known sheet information
      const customerData = await this.getCustomerData(id, usingCompletedSheet);
      
      // Only send email if we have a valid PDF URL
      if (pdfLink && !pdfLink.includes('placeholder')) {
        // Send email notification and track delivery
        this.logger.info(`Sending completion email to ${customerData.email}`);
        
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
      } else {
        this.logger.warn(`Skipping email due to invalid PDF URL`);
        await this.updateStatus(id, 'Warning', `Email not sent - invalid PDF URL`, usingCompletedSheet);
      }
      
      return { pdfLink, docLink, emailResult: {} };
    } catch (error) {
      this.logger.error(`Error finalizing appraisal:`, error);
      await this.updateStatus(id, 'Failed', `PDF generation failed`, usingCompletedSheet);
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
      this.logger.error(`Error fetching customer data:`, error);
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
      
      this.logger.info(`Appraisal ${id} marked as complete`);
    } catch (error) {
      this.logger.error(`Error completing appraisal:`, error);
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

  async applyWordPressTemplate(id, postId, usingCompletedSheet = false) {
    try {
      this.logger.info(`Applying WordPress template pattern to post ${postId} for appraisal ${id}`);
      
      // Get the current post content
      const post = await this.wordpressService.getPost(postId);
      let content = post.content?.rendered || '';
      
      // The WordPress block pattern ID is 142384
      const blockPatternCode = `<!-- wp:block {"ref":142384} /-->`;
      
      // Check if the block pattern is already in the content
      if (!content.includes(blockPatternCode)) {
        // Add the block pattern to the beginning of the content
        const updatedContent = blockPatternCode;
        
        // Update the WordPress post with the new content
        // We're only sending the block reference, not the original content
        // This prevents duplication of content when WordPress expands the block
        await this.wordpressService.updateAppraisalPost(postId, {
          content: updatedContent
        });
        
        this.logger.info(`Successfully applied WordPress template pattern to post ${postId}`);
      } else {
        this.logger.info(`WordPress template pattern already exists in post ${postId}`);
        
        // If the pattern exists but we see expanded content, fix it
        // We need to clean up any expanded block content to prevent duplications
        if (content.includes(blockPatternCode) && content.length > blockPatternCode.length + 100) {
          this.logger.info(`Found expanded block content, cleaning up to prevent duplication`);
          await this.wordpressService.updateAppraisalPost(postId, {
            content: blockPatternCode
          });
        }
      }
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error applying WordPress template to post ${postId}:`, error);
      await this.updateStatus(id, 'Warning', `Failed to apply WordPress template`, usingCompletedSheet);
      // Don't throw the error, allow the process to continue
      return { success: false, error: error.message };
    }
  }
}

module.exports = AppraisalService;