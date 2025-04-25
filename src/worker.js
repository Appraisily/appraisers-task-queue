const { createLogger } = require('./utils/logger');
const secretManager = require('./utils/secrets');
const SheetsService = require('./services/sheets.service');
const WordPressService = require('./services/wordpress.service');
const OpenAIService = require('./services/openai.service');
const EmailService = require('./services/email.service');
const PDFService = require('./services/pdf.service');
const AppraisalService = require('./services/appraisal.service');
const AppraisalFinder = require('./utils/appraisal-finder');

class Worker {
  constructor() {
    this.logger = createLogger('Worker');
    this.sheetsService = new SheetsService();
    this.appraisalService = null;
    this.activeProcesses = new Set();
    this.isShuttingDown = false;
    this.appraisalFinder = null;
  }

  async initialize() {
    try {
      this.logger.info('Initializing worker...');

      // Initialize Secret Manager first
      await secretManager.initialize();

      // Get spreadsheet ID from Secret Manager
      const spreadsheetId = await secretManager.getSecret('PENDING_APPRAISALS_SPREADSHEET_ID');
      if (!spreadsheetId) {
        throw new Error('Failed to get spreadsheet ID from Secret Manager');
      }

      this.logger.info(`Using spreadsheet ID: ${spreadsheetId}`);
      
      // Initialize all services
      await this.sheetsService.initialize({ PENDING_APPRAISALS_SPREADSHEET_ID: spreadsheetId });
      const wordpressService = new WordPressService();
      const openaiService = new OpenAIService();
      const emailService = new EmailService();
      const pdfService = new PDFService();
      
      // Initialize services concurrently
      this.logger.info('Initializing dependent services...');
      await Promise.all([
        wordpressService.initialize(),
        openaiService.initialize(),
        emailService.initialize(),
        pdfService.initialize()
      ]);
      
      // Initialize appraisal finder first to avoid race conditions
      this.appraisalFinder = new AppraisalFinder(this.sheetsService);
      
      // Initialize AppraisalService with all dependencies
      this.appraisalService = new AppraisalService(
        this.sheetsService,
        wordpressService,
        openaiService,
        emailService,
        pdfService
      );
      
      this.logger.info('Worker initialized successfully - appraisal service is ready for immediate use');
    } catch (error) {
      this.logger.error('Failed to initialize worker:', error);
      throw error;
    }
  }

  /**
   * Process an appraisal from a specific step directly without using PubSub
   * @param {string|number} id - Appraisal ID
   * @param {string} startStep - Step to start processing from
   * @param {object} options - Additional options
   * @returns {Promise<void>}
   */
  async processFromStep(id, startStep, options = {}) {
    if (this.isShuttingDown) {
      this.logger.warn('Worker is shutting down, rejecting new processing request');
      throw new Error('Service is shutting down, try again later');
    }

    const processId = `${id}-${Date.now()}`;
    this.activeProcesses.add(processId);

    try {
      this.logger.info(`Processing appraisal ${id} from step ${startStep}`);
      
      // Parse the data
      // Check message type and handle accordingly
      // Extract any additional data from options that might be needed
      const { appraisalValue, description, appraisalType, postId, username, timestamp } = options;
      
      // Log user information if available
      if (username || timestamp) {
        this.logger.info(`Request initiated by ${username || 'Unknown User'} at ${timestamp || new Date().toISOString()}`);
      }
      
      // Process based on step
      switch (startStep) {
        case 'STEP_SET_VALUE':
          // Before error checking, verify if the appraisal exists in either sheet
          try {
            const { exists, usingCompletedSheet } = await this.appraisalFinder.appraisalExists(id);
            
            if (exists) {
              // First, update status with correct sheet
              await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheet);
              
              // Fetch all necessary data at once
              const { data: fullRowData } = await this.appraisalFinder.getFullRow(id, 'A:Q');
              
              // Extract values from the row or use the ones provided in request
              const valueToUse = appraisalValue || (fullRowData?.[0]?.[9] || null); // Column J is index 9
              const descToUse = description || (fullRowData?.[0]?.[10] || null); // Column K is index 10
              const typeToUse = appraisalType || (fullRowData?.[0]?.[1] || 'Regular'); // Column B is index 1
              
              this.logger.info(`Retrieved data for appraisal ${id}: value=${valueToUse}, type=${typeToUse}`);
              
              if (!valueToUse && !descToUse) {
                throw new Error('Missing required fields for STEP_SET_VALUE: appraisalValue or description');
              }
              
              // Start full processing with all data
              await this.appraisalService.processAppraisal(id, valueToUse, descToUse, typeToUse);
            } else {
              throw new Error(`Appraisal ${id} not found in either pending or completed sheet`);
            }
          } catch (error) {
            if (error.message.includes('Missing required fields')) {
              // If error is about missing fields and we didn't check the sheet data,
              // just check the provided params
              if (!appraisalValue && !description) {
                throw new Error('Missing required fields for STEP_SET_VALUE: appraisalValue or description');
              }
              // Start full processing with the provided params
              await this.appraisalService.processAppraisal(id, appraisalValue, description, appraisalType);
            } else {
              // Rethrow other errors
              throw error;
            }
          }
          break;
          
        case 'STEP_MERGE_DESCRIPTIONS':
          // Need description at minimum
          
          try {
            // Use the appraisalFinder to check and get data from either sheet
            const { exists, usingCompletedSheet } = await this.appraisalFinder.appraisalExists(id);
            
            if (!exists) {
              throw new Error(`Appraisal ${id} not found in either pending or completed sheets`);
            }
            
            // Log which sheet we're using
            this.logger.info(`Processing merge using ${usingCompletedSheet ? 'completed' : 'pending'} sheet for appraisal ${id}`);
            
            // Get WordPress post ID first
            const { data: postIdData } = await this.appraisalFinder.findAppraisalData(id, `G${id}`);
            if (!postIdData || !postIdData[0] || !postIdData[0][0]) {
              throw new Error(`No WordPress URL found for appraisal ${id} in either sheet`);
            }
            
            // Extract post ID from WordPress URL
            const wpUrl = postIdData[0][0];
            const url = new URL(wpUrl);
            const postId = url.searchParams.get('post');
            
            if (!postId) {
              throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
            }
            
            // Get existing data directly with one call to minimize sheet operations
            const { data: existingData } = await this.appraisalFinder.findAppraisalData(id, `A${id}:L${id}`);
            
            if (!existingData || !existingData[0]) {
              throw new Error('No existing data found for appraisal');
            }
            
            // Get value and existing description from the row data
            // Column J (index 9) is value, Column K (index 10) is description
            const value = existingData[0][9]; // Column J
            const existingDescription = existingData[0][10]; // Column K
            
            // Use provided description or existing one
            const descToUse = description || existingDescription;
            
            // Update status in Google Sheets only (no WordPress updates)
            await this.appraisalService.updateStatus(id, 'Analyzing', 'Analyzing image and merging descriptions', usingCompletedSheet);
            
            // Use the imageAnalysis method to analyze image and merge descriptions
            const analysisResult = await this.analyzeImageAndMergeDescriptions(id, postId, descToUse, {
              usingCompletedSheet: usingCompletedSheet
            });
            
            // Save titles to Google Sheets
            this.logger.info(`Saving titles and description to Google Sheets for appraisal ${id}`);
            await this.sheetsService.updateValues(`S${id}`, [[analysisResult.briefTitle]], usingCompletedSheet);
            await this.sheetsService.updateValues(`T${id}`, [[analysisResult.mergedDescription]], usingCompletedSheet);
            
            // Only update WordPress if we have new data to set
            if (analysisResult && analysisResult.briefTitle && analysisResult.mergedDescription) {
              this.logger.info(`Updating WordPress post ${postId} with new titles and metadata`);
              
              // Use the brief title for the WordPress post title
              // Use the merged description as the detailed title
              await this.appraisalService.wordpressService.updateAppraisalPost(postId, {
                title: analysisResult.briefTitle,
                detailedTitle: analysisResult.mergedDescription
                // No additional metadata fields - removed as requested
              });
              
              this.logger.info(`WordPress post ${postId} updated successfully`);
            } else {
              this.logger.info(`Skipping WordPress update for appraisal ${id} - no new data to set`);
            }
            
            // Final status update in Google Sheets
            await this.appraisalService.updateStatus(id, 'Ready', 'Description merged and metadata updated', usingCompletedSheet);
          } catch (error) {
            this.logger.error(`Error in STEP_MERGE_DESCRIPTIONS for appraisal ${id}:`, error);
            throw error;
          }
          
          break;
          
        case 'STEP_UPDATE_WORDPRESS':
          
          // Check if this appraisal is in the pending or completed sheet
          let usingCompletedSheetForWP = false;
          
          // Get required data from spreadsheet - first try pending sheet
          let valueData = await this.sheetsService.getValues(`J${id}`);
          let descData = await this.sheetsService.getValues(`L${id}`);
          let appraisalTypeData = await this.sheetsService.getValues(`B${id}`);
          
          // If any data is missing, check completed sheet
          if (!valueData || !valueData[0] || !descData || !descData[0] || !appraisalTypeData || !appraisalTypeData[0]) {
            this.logger.info(`Data missing in pending sheet for appraisal ${id}, checking completed sheet`);
            try {
              // Check if data exists in completed sheet
              const testData = await this.sheetsService.getValues(`A${id}`, true);
              if (testData && testData[0]) {
                usingCompletedSheetForWP = true;
                this.logger.info(`Found appraisal ${id} in completed sheet`);
                
                // Get all required data from the completed sheet
                valueData = await this.sheetsService.getValues(`J${id}`, true);
                descData = await this.sheetsService.getValues(`L${id}`, true);
                appraisalTypeData = await this.sheetsService.getValues(`B${id}`, true);
              }
            } catch (error) {
              this.logger.error(`Error checking completed sheet: ${error.message}`);
            }
          }
          
          // Log which sheet we're using
          this.logger.info(`Processing WordPress update using ${usingCompletedSheetForWP ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          const valueToUse = appraisalValue || (valueData?.[0]?.[0] || 0);
          const descriptionToUse = descData?.[0]?.[0] || '';
          const typeToUse = appraisalType || appraisalTypeData?.[0]?.[0] || 'Regular';
          
          // Update WordPress
          await this.appraisalService.updateStatus(id, 'Updating', 'Setting titles and metadata in WordPress', usingCompletedSheetForWP);
          await this.appraisalService.updateWordPress(id, valueToUse, descriptionToUse, typeToUse);
          break;
          
        case 'STEP_GENERATE_VISUALIZATION':
          
          // Check if this appraisal is in the pending or completed sheet
          let usingCompletedSheetForVis = false;
          
          // Get the PostID either from options or from spreadsheet
          let postIdToUse = postId;
          if (!postIdToUse) {
            try {
              // First check in pending sheet
              const postData = await this.sheetsService.getValues(`G${id}`);
              
              if (!postData || !postData[0] || !postData[0][0]) {
                // If not found, check completed sheet
                this.logger.info(`WordPress URL not found in pending sheet for appraisal ${id}, checking completed sheet`);
                const completedPostData = await this.sheetsService.getValues(`G${id}`, true);
                
                if (completedPostData && completedPostData[0] && completedPostData[0][0]) {
                  usingCompletedSheetForVis = true;
                  this.logger.info(`Found appraisal ${id} in completed sheet`);
                  
                  // Extract post ID from WordPress URL
                  const wpUrl = completedPostData[0][0];
                  const url = new URL(wpUrl);
                  postIdToUse = url.searchParams.get('post');
                }
              } else {
                // Extract post ID from WordPress URL
                const wpUrl = postData[0][0];
                const url = new URL(wpUrl);
                postIdToUse = url.searchParams.get('post');
              }
            } catch (error) {
              this.logger.error(`Error getting WordPress URL for appraisal ${id}:`, error);
            }
          }
          
          if (!postIdToUse) {
            throw new Error('Post ID is required for generating visualizations');
          }
          
          // Log which sheet we're using
          this.logger.info(`Processing visualization using ${usingCompletedSheetForVis ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          // Update status
          await this.appraisalService.updateStatus(id, 'Generating', 'Creating visualizations', usingCompletedSheetForVis);
          
          // Complete the report (which includes visualizations)
          await this.wordpressService.completeAppraisalReport(postIdToUse);
          
          // Update status when done
          await this.appraisalService.updateStatus(id, 'Generating', 'Visualizations created successfully', usingCompletedSheetForVis);
          break;
          
        case 'STEP_GENERATE_PDF':
          
          // Get PostID using the appraisalFinder utility
          let pdfPostId = postId;
          let usingCompletedSheetForPDF = false;
          
          if (!pdfPostId) {
            try {
              // Use the appraisalFinder to get WordPress URL from either sheet
              const { data: postData, usingCompletedSheet } = await this.appraisalFinder.findAppraisalData(id, `G${id}`);
              usingCompletedSheetForPDF = usingCompletedSheet;
              
              if (!postData || !postData[0] || !postData[0][0]) {
                throw new Error(`No WordPress URL found for appraisal ${id} in either sheet`);
              }
              
              // Extract post ID from WordPress URL
              const wpUrl = postData[0][0];
              const url = new URL(wpUrl);
              pdfPostId = url.searchParams.get('post');
              
              if (!pdfPostId) {
                throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
              }
              
              this.logger.info(`Extracted WordPress post ID ${pdfPostId} for appraisal ${id} from ${usingCompletedSheetForPDF ? 'completed' : 'pending'} sheet`);
            } catch (error) {
              this.logger.error(`Error getting WordPress URL for appraisal ${id}:`, error);
              throw error;
            }
          }
          
          if (!pdfPostId) {
            throw new Error('Post ID is required for generating PDF');
          }
          
          try {
            // Log which sheet we're using
            this.logger.info(`Processing PDF generation using ${usingCompletedSheetForPDF ? 'completed' : 'pending'} sheet for appraisal ${id}`);
            
            // Update status
            await this.appraisalService.updateStatus(id, 'Finalizing', 'Creating PDF document', usingCompletedSheetForPDF);
            
            // Get public URL
            const publicUrl = await this.appraisalService.wordpressService.getPermalink(pdfPostId);
            
            // Generate PDF - this will throw an error if the PDF generation fails
            this.logger.info(`Waiting for PDF generation for appraisal ${id} with post ID ${pdfPostId}`);
            const pdfResult = await this.appraisalService.finalize(id, pdfPostId, publicUrl, usingCompletedSheetForPDF);
            
            // Validate PDF URLs
            if (!pdfResult.pdfLink || pdfResult.pdfLink.includes('placeholder')) {
              throw new Error(`PDF generation returned placeholder or invalid URLs`);
            }
            
            // Update status with the actual PDF link
            await this.appraisalService.updateStatus(id, 'Finalizing', `PDF created: ${pdfResult.pdfLink}`, usingCompletedSheetForPDF);
            
            // Mark as complete if was a full process (only if in pending sheet)
            if (!usingCompletedSheetForPDF) {
              await this.appraisalService.updateStatus(id, 'Completed', 'PDF created and emailed to customer');
            }
            
          } catch (error) {
            this.logger.error(`PDF generation failed for appraisal ${id}: ${error.message}`);
            await this.appraisalService.updateStatus(id, 'Failed', `PDF generation failed: ${error.message}`, usingCompletedSheetForPDF);
            throw error;
          }
          break;
          
        case 'STEP_BUILD_REPORT':
          // New step to handle building the full report
          
          // Check if this appraisal is in the pending or completed sheet
          let usingCompletedSheetForReport = false;
          
          // Get required data from spreadsheet - first try pending sheet
          let fullProcessData = await this.sheetsService.getValues(`B${id}:L${id}`);
          
          // If not found, check completed sheet
          if (!fullProcessData || !fullProcessData[0]) {
            this.logger.info(`No data found in pending sheet for appraisal ${id}, checking completed sheet`);
            fullProcessData = await this.sheetsService.getValues(`B${id}:L${id}`, true);
            if (fullProcessData && fullProcessData[0]) {
              usingCompletedSheetForReport = true;
              this.logger.info(`Found appraisal ${id} in completed sheet`);
            }
          }
          
          if (!fullProcessData || !fullProcessData[0]) {
            throw new Error('No data found for appraisal');
          }
          
          // Log which sheet we're using
          this.logger.info(`Processing full report using ${usingCompletedSheetForReport ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheetForReport);
          
          const row = fullProcessData[0];
          const type = row[0] || 'Regular';
          const appraisalValueFromSheet = row[8]; // Column J
          const descriptionFromSheet = row[9]; // Column K
          
          // Process appraisal with existing data
          await this.appraisalService.processAppraisal(
            id, 
            appraisalValueFromSheet, 
            descriptionFromSheet, 
            type
          );
          break;
          
        default:
          this.logger.warn(`Unknown step: ${startStep}. Attempting to run full process.`);
          
          // Check if this appraisal is in the pending or completed sheet
          let usingCompletedSheetForDefault = false;
          
          // Get all necessary data from the spreadsheet - first try pending sheet
          let defaultData = await this.sheetsService.getValues(`B${id}:L${id}`);
          
          // If not found, check completed sheet
          if (!defaultData || !defaultData[0]) {
            this.logger.info(`No data found in pending sheet for appraisal ${id}, checking completed sheet`);
            defaultData = await this.sheetsService.getValues(`B${id}:L${id}`, true);
            if (defaultData && defaultData[0]) {
              usingCompletedSheetForDefault = true;
              this.logger.info(`Found appraisal ${id} in completed sheet`);
            }
          }
          
          if (!defaultData || !defaultData[0]) {
            throw new Error('No data found for appraisal');
          }
          
          // Log which sheet we're using
          this.logger.info(`Processing using ${usingCompletedSheetForDefault ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          // Update status
          await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheetForDefault);
          
          const defaultRow = defaultData[0];
          const defaultType = defaultRow[0] || 'Regular';
          const defaultValue = defaultRow[8]; // Column J
          const defaultDesc = defaultRow[9]; // Column K
          
          await this.appraisalService.processAppraisal(
            id,
            defaultValue,
            defaultDesc,
            defaultType
          );
      }
      
      this.logger.info(`Successfully processed appraisal ${id} from step ${startStep}`);
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id} from step ${startStep}:`, error);
      
      // Update status to failed
      try {
        await this.appraisalService.updateStatus(id, 'Failed', `Error: ${error.message}`);
      } catch (statusError) {
        this.logger.error(`Error updating status for failed appraisal ${id}:`, statusError);
      }
      
      // Re-throw the error
      throw error;
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  /**
   * Specialized method to analyze an image with GPT-4o and merge descriptions
   * @param {string|number} id - Appraisal ID
   * @param {string|number} postId - WordPress post ID
   * @param {string} customerDescription - Customer provided description (optional)
   * @param {object} options - Additional options
   * @returns {Promise<object>} - Results of the processing
   */
  async analyzeImageAndMergeDescriptions(id, postId, customerDescription = '', options = {}) {
    if (this.isShuttingDown) {
      this.logger.warn('Worker is shutting down, rejecting new processing request');
      throw new Error('Service is shutting down, try again later');
    }

    const processId = `image-analysis-${id}-${Date.now()}`;
    this.activeProcesses.add(processId);

    try {
      const { usingCompletedSheet = false } = options;
      this.logger.info(`Starting image analysis and description merging for appraisal ${id} using ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      
      // Update status in Google Sheets only
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Retrieving image for AI analysis', usingCompletedSheet);

      // 1. Get the main image from WordPress
      const wordpressService = this.appraisalService.wordpressService;
      this.logger.info(`Requesting WordPress post data for post ID ${postId}`);
      const postData = await wordpressService.getPost(postId);
      
      if (!postData) {
        this.logger.error(`Failed to retrieve post data for post ID ${postId}`);
        throw new Error(`Failed to retrieve post data for post ID ${postId}`);
      }
      
      // Simplified logging
      this.logger.info(`Post retrieval successful. Post ID: ${postData.id}`);
      
      // Get the main image URL from ACF fields
      let mainImageUrl = null;
      
      if (postData.acf && postData.acf.main) {
        // Just log the image ID instead of the full structure
        if (typeof postData.acf.main === 'number' || typeof postData.acf.main === 'string') {
          this.logger.info(`Found 'main' ACF field with value: ${postData.acf.main}`);
        } else {
          this.logger.info(`Found 'main' ACF field (object type)`);
        }
        
        // Use the WordPress service's getImageUrl method
        mainImageUrl = await wordpressService.getImageUrl(postData.acf.main);
        
        if (mainImageUrl) {
          this.logger.info(`Successfully retrieved main image URL: ${mainImageUrl}`);
        } else {
          this.logger.warn(`Failed to retrieve URL from main image field`);
        }
      } else {
        this.logger.warn(`ACF 'main' field not found in post data`);
      }
      
      // If main image not found, try to use the featured image
      if (!mainImageUrl && postData.featured_media_url) {
        mainImageUrl = postData.featured_media_url;
        this.logger.info(`Using featured image URL instead: ${mainImageUrl}`);
      }
      
      if (!mainImageUrl) {
        this.logger.error(`No image found in WordPress post. API URL used: ${this.appraisalService.wordpressService.apiUrl}/appraisals/${postId}`);
        throw new Error('No main image found in the WordPress post');
      }
      
      this.logger.info(`Retrieved main image URL: ${mainImageUrl}`);
      
      // 2. Analyze the image with GPT-4o
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Generating AI image analysis with GPT-4o', usingCompletedSheet);
      const openaiService = this.appraisalService.openaiService;
      
      const imageAnalysisPrompt = 
        "You are an expert art and antiquity appraiser with decades of experience. " +
        "Please analyze this image thoroughly and provide a detailed, professional description of what you see. " +
        "Focus on all aspects including: style, period, materials, condition, craftsmanship, artistic significance, " +
        "and any notable features. If it's an antiquity, describe its historical context and significance. " +
        "Be comprehensive and use appropriate technical terminology. " +
        "Your description will be used for a professional appraisal document.";
      
      const aiImageDescription = await openaiService.analyzeImageWithGPT4o(mainImageUrl, imageAnalysisPrompt);
      
      if (!aiImageDescription) {
        throw new Error('Failed to generate AI image description');
      }
      
      this.logger.info(`Generated AI image description (${aiImageDescription.length} chars)`);
      
      // 3. Save the AI image description to the Google Sheet
      await this.appraisalService.updateStatus(id, 'Updating', 'Saving AI image analysis', usingCompletedSheet);
      await this.sheetsService.updateValues(`H${id}`, [[aiImageDescription]], usingCompletedSheet);
      
      // 4. Get or update customer description
      if (customerDescription) {
        await this.sheetsService.updateValues(`K${id}`, [[customerDescription]], usingCompletedSheet);
      } else {
        // Try to get existing customer description if not provided
        const existingData = await this.sheetsService.getValues(`K${id}`, usingCompletedSheet);
        if (existingData && existingData[0] && existingData[0][0]) {
          customerDescription = existingData[0][0];
        } else {
          // If still no customer description is available, use an empty string as fallback
          this.logger.warn(`No customer description found for appraisal ${id}, using empty string`);
          customerDescription = '';
        }
      }
      
      // 5. Merge descriptions (AI image analysis + customer description)
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Merging descriptions', usingCompletedSheet);
      
      const mergeResult = await this.appraisalService.mergeDescriptions(id, customerDescription, usingCompletedSheet);
      
      // 6. Return all the data
      const result = {
        appraisalId: id,
        postId: postId,
        aiImageDescription: aiImageDescription,
        customerDescription: customerDescription,
        mergedDescription: mergeResult.mergedDescription,
        briefTitle: mergeResult.briefTitle,
        detailedTitle: mergeResult.detailedTitle,
        metadata: mergeResult.metadata
      };
      
      this.logger.info(`Successfully completed image analysis and description merging for appraisal ${id}`);
      
      return result;
    } catch (error) {
      this.logger.error(`Error analyzing image and merging descriptions for appraisal ${id}:`, error);
      
      // Update status to failed
      try {
        await this.appraisalService.updateStatus(id, 'Failed', `Image analysis error: ${error.message}`);
      } catch (statusError) {
        this.logger.error(`Error updating status for failed appraisal ${id}:`, statusError);
      }
      
      // Re-throw the error
      throw error;
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  async handleError(error) {
    this.logger.error('Worker error:', error);
  }

  async shutdown() {
    this.logger.info('Shutting down worker...');
    this.isShuttingDown = true;
    
    // Wait for active processes to complete (with a timeout)
    if (this.activeProcesses.size > 0) {
      this.logger.info(`Waiting for ${this.activeProcesses.size} active processes to complete...`);
      
      // Wait up to 30 seconds for processes to complete
      const timeout = setTimeout(() => {
        this.logger.warn(`Forcing shutdown with ${this.activeProcesses.size} processes still active`);
      }, 30000);
      
      // Wait for the shorter of: all processes completing or the timeout
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (this.activeProcesses.size === 0) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        }, 1000);
      });
    }
    
    this.logger.info('Worker shutdown complete');
  }
}

// Export a singleton instance
const worker = new Worker();
module.exports = worker;