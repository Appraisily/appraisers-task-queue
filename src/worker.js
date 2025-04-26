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
   * @param {boolean} usingCompletedSheet - Flag indicating which sheet the appraisal is in
   * @param {object} options - Additional options
   * @returns {Promise<void>}
   */
  async processFromStep(id, startStep, usingCompletedSheet, options = {}) {
    if (this.isShuttingDown) {
      this.logger.warn('Worker is shutting down, rejecting new processing request');
      throw new Error('Service is shutting down, try again later');
    }

    const processId = `${id}-${Date.now()}`;
    this.activeProcesses.add(processId);

    try {
      // Log the determined sheet context
      this.logger.info(`Processing appraisal ${id} from step ${startStep} (Sheet: ${usingCompletedSheet ? 'Completed' : 'Pending'})`);
      
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
          // We already know the sheet from the function parameter `usingCompletedSheet`
          try {
            // Fetch all required data in a single operation, reducing API calls
            // Pass the sheet flag to getMultipleFields
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['J', 'K'], usingCompletedSheet);
            
            // Use provided values, or values from sheet if they exist
            const valueToUse = appraisalValue || (appraisalData.J || null);
            const descToUse = description || (appraisalData.K || null);
            
            if (!valueToUse && !descToUse) {
              throw new Error('Missing required fields for STEP_SET_VALUE: appraisalValue or description');
            }
            
            // Update status with the correct sheet (passed as parameter)
            await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheet);
            
            // Start full processing, passing the sheet context
            // Pass the usingCompletedSheet flag explicitly to processAppraisal
            await this.appraisalService.processAppraisal(id, valueToUse, descToUse, appraisalType, usingCompletedSheet);
          } catch (error) {
            // Log the error and use the determined sheet context for status update
            this.logger.error(`Error in STEP_SET_VALUE for appraisal ${id} on ${usingCompletedSheet ? 'Completed' : 'Pending'} sheet:`, error);
            await this.appraisalService.updateStatus(id, 'Failed', `STEP_SET_VALUE Error: ${error.message}`, usingCompletedSheet);
            throw error; // Re-throw after logging and status update
          }
          break;
          
        case 'STEP_MERGE_DESCRIPTIONS':
          // We already know the sheet from the function parameter `usingCompletedSheet`
          try {
            this.logger.info(`Processing merge using ${usingCompletedSheet ? 'completed' : 'pending'} sheet for appraisal ${id}`);
            
            // Get all data we need in a single call, passing the sheet flag
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['G', 'J', 'K'], usingCompletedSheet);
            
            if (!appraisalData.G) {
              throw new Error(`No WordPress URL found for appraisal ${id} in either sheet`);
            }
            
            // Extract post ID from WordPress URL
            const wpUrl = appraisalData.G;
            const url = new URL(wpUrl);
            const postId = url.searchParams.get('post');
            
            if (!postId) {
              throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
            }
            
            // Get value and existing description directly from the fetched data
            const value = appraisalData.J;
            const existingDescription = appraisalData.K;
            
            // Use provided description or existing one
            const descToUse = description || existingDescription;
            
            // Update status in Google Sheets only (no WordPress updates)
            await this.appraisalService.updateStatus(id, 'Analyzing', 'Analyzing image and merging descriptions', usingCompletedSheet);
            
            // Use the imageAnalysis method to analyze image and merge descriptions
            const analysisResult = await this.analyzeImageAndMergeDescriptions(id, postId, descToUse, {
              usingCompletedSheet: usingCompletedSheet // Pass the flag here too
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
              });
              
              this.logger.info(`WordPress post ${postId} updated successfully`);
            } else {
              this.logger.info(`Skipping WordPress update for appraisal ${id} - no new data to set`);
            }
            
            // Final status update in Google Sheets
            await this.appraisalService.updateStatus(id, 'Ready', 'Description merged and metadata updated', usingCompletedSheet);
          } catch (error) {
            this.logger.error(`Error in STEP_MERGE_DESCRIPTIONS for appraisal ${id} on ${usingCompletedSheet ? 'Completed' : 'Pending'} sheet:`, error);
            await this.appraisalService.updateStatus(id, 'Failed', `MERGE_DESC Error: ${error.message}`, usingCompletedSheet);
            throw error;
          }
          
          break;
          
        case 'STEP_UPDATE_WORDPRESS':
          // Use the passed usingCompletedSheet flag directly
          const usingCompletedSheetForWP = usingCompletedSheet;
          this.logger.info(`Processing WordPress update using ${usingCompletedSheetForWP ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          try {
            // Fetch required data using the known sheet
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'L'], usingCompletedSheetForWP);
            
            const valueToUse = appraisalValue || (appraisalData.J || 0);
            const descriptionToUse = appraisalData.L || ''; // Use merged description from Col L
            const typeToUse = appraisalType || appraisalData.B || 'Regular';
            
            // Update WordPress
            await this.appraisalService.updateStatus(id, 'Updating', 'Setting titles and metadata in WordPress', usingCompletedSheetForWP);
            await this.appraisalService.updateWordPress(id, valueToUse, descriptionToUse, typeToUse, usingCompletedSheetForWP); // Pass usingCompletedSheetForWP flag
          } catch (error) {
             this.logger.error(`Error in STEP_UPDATE_WORDPRESS for appraisal ${id} on ${usingCompletedSheetForWP ? 'Completed' : 'Pending'} sheet:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `UPDATE_WP Error: ${error.message}`, usingCompletedSheetForWP);
             throw error;
          }
          break;
          
        case 'STEP_GENERATE_VISUALIZATION':
          // Use the passed usingCompletedSheet flag directly
          const usingCompletedSheetForVis = usingCompletedSheet;
          this.logger.info(`Processing visualization using ${usingCompletedSheetForVis ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          try {
            // Get the PostID either from options or from spreadsheet (using the known sheet)
            let postIdToUse = postId;
            if (!postIdToUse) {
                const { data: postData } = await this.appraisalFinder.getMultipleFields(id, ['G'], usingCompletedSheetForVis);
                
                if (!postData || !postData.G) {
                   throw new Error('WordPress URL not found');
                }
                 // Extract post ID from WordPress URL
                const wpUrl = postData.G;
                const url = new URL(wpUrl);
                postIdToUse = url.searchParams.get('post');
                if (!postIdToUse) {
                  throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
                }
            }
            
            // Don't update status to "Generating" in the sheets
            // Just log that we're generating the visualization
            this.logger.info(`Generating visualization for appraisal ${id} (WordPress Post ID: ${postIdToUse})`);
            
            // Complete the report (which includes visualizations)
            // wordpressService is likely accessed via appraisalService
            await this.appraisalService.wordpressService.completeAppraisalReport(postIdToUse);
            
            // Log completion but don't update sheet status
            this.logger.info(`Appraisal report created successfully for ${id}`);
          } catch (error) {
             this.logger.error(`Error in STEP_GENERATE_VISUALIZATION for appraisal ${id} on ${usingCompletedSheetForVis ? 'Completed' : 'Pending'} sheet:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `GEN_VIS Error: ${error.message}`, usingCompletedSheetForVis);
             throw error;
          }
          break;
          
        case 'STEP_GENERATE_PDF':
          // Use the passed usingCompletedSheet flag directly
          const usingCompletedSheetForPDF = usingCompletedSheet;
          this.logger.info(`Processing PDF generation using ${usingCompletedSheetForPDF ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          try {
            // Get PostID using the appraisalFinder utility with the known sheet
            let pdfPostId = postId;
            if (!pdfPostId) {
               const { data: postData } = await this.appraisalFinder.getMultipleFields(id, ['G'], usingCompletedSheetForPDF);
                if (!postData || !postData.G) {
                  throw new Error('WordPress URL not found');
                }
                const wpUrl = postData.G;
                const url = new URL(wpUrl);
                pdfPostId = url.searchParams.get('post');
                if (!pdfPostId) {
                  throw new Error(`Could not extract post ID from WordPress URL: ${wpUrl}`);
                }
                this.logger.info(`Extracted WordPress post ID ${pdfPostId} for appraisal ${id} from ${usingCompletedSheetForPDF ? 'completed' : 'pending'} sheet`);
            }
            
            // Update status
            await this.appraisalService.updateStatus(id, 'Finalizing', 'Creating PDF document', usingCompletedSheetForPDF);
            
            // Get public URL
            const publicUrl = await this.appraisalService.wordpressService.getPermalink(pdfPostId);
            
            // Generate PDF - this will throw an error if the PDF generation fails
            this.logger.info(`Waiting for PDF generation for appraisal ${id} with post ID ${pdfPostId}`);
            const pdfResult = await this.appraisalService.finalize(id, pdfPostId, publicUrl, usingCompletedSheetForPDF); // finalize likely uses the flag internally
            
            // Validate PDF URLs
            if (!pdfResult.pdfLink || pdfResult.pdfLink.includes('placeholder')) {
              throw new Error(`PDF generation returned placeholder or invalid URLs`);
            }
            
            // Update status with the actual PDF link
            await this.appraisalService.updateStatus(id, 'Finalizing', `PDF created: ${pdfResult.pdfLink}`, usingCompletedSheetForPDF);
            
            // Mark as complete if it was a full process (only if in pending sheet)
            if (!usingCompletedSheetForPDF) {
              await this.appraisalService.updateStatus(id, 'Completed', 'PDF created and emailed to customer', usingCompletedSheetForPDF); // Should status be updated on pending (false)? Yes.
            }
            
          } catch (error) {
            this.logger.error(`Error in STEP_GENERATE_PDF for appraisal ${id} on ${usingCompletedSheetForPDF ? 'Completed' : 'Pending'} sheet:`, error);
            await this.appraisalService.updateStatus(id, 'Failed', `GEN_PDF Error: ${error.message}`, usingCompletedSheetForPDF);
            throw error;
          }
          break;
          
        case 'STEP_BUILD_REPORT':
          // Use the passed usingCompletedSheet flag directly
          const usingCompletedSheetForReport = usingCompletedSheet;
          this.logger.info(`Processing full report using ${usingCompletedSheetForReport ? 'completed' : 'pending'} sheet for appraisal ${id}`);
          
          try {
            await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheetForReport);
            
            // Fetch required data using the known sheet
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'K'], usingCompletedSheetForReport);
            
            const type = appraisalData.B || 'Regular';
            const appraisalValueFromSheet = appraisalData.J; // Column J
            const descriptionFromSheet = appraisalData.K; // Column K
            
            // Process appraisal with existing data
            // Pass the usingCompletedSheet flag explicitly
            await this.appraisalService.processAppraisal(
              id, 
              appraisalValueFromSheet, 
              descriptionFromSheet, 
              type,
              usingCompletedSheetForReport
            );
           } catch (error) {
             this.logger.error(`Error in STEP_BUILD_REPORT for appraisal ${id} on ${usingCompletedSheetForReport ? 'Completed' : 'Pending'} sheet:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `BUILD_REPORT Error: ${error.message}`, usingCompletedSheetForReport);
             throw error;
          }
          break;
          
        default:
          // Use the passed usingCompletedSheet flag directly
          const usingCompletedSheetForDefault = usingCompletedSheet;
          this.logger.warn(`Unknown step: ${startStep}. Attempting to run full process using ${usingCompletedSheetForDefault ? 'completed' : 'pending'} sheet.`);
          
          try {
             // Update status
             await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow (default step)', usingCompletedSheetForDefault);
             
             // Get all necessary data from the spreadsheet using the known sheet
             const { data: defaultData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'K'], usingCompletedSheetForDefault);
             
             const defaultType = defaultData.B || 'Regular';
             const defaultValue = defaultData.J; // Column J
             const defaultDesc = defaultData.K; // Column K
             
             // Pass the usingCompletedSheet flag explicitly
             await this.appraisalService.processAppraisal(
               id,
               defaultValue,
               defaultDesc,
               defaultType,
               usingCompletedSheetForDefault
             );
           } catch (error) {
             this.logger.error(`Error in default processing step for appraisal ${id} on ${usingCompletedSheetForDefault ? 'Completed' : 'Pending'} sheet:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `DEFAULT Error: ${error.message}`, usingCompletedSheetForDefault);
             throw error;
          }
      }
      
      this.logger.info(`Successfully processed appraisal ${id} from step ${startStep}`);
    } catch (error) { // Catch errors from the switch statement or initial checks
      // General error logging - specific errors within cases should already be logged and status updated
      this.logger.error(`Overall error processing appraisal ${id} from step ${startStep}:`, error.message);
      
      // Ensure status is set to Failed if not already done by a specific case
      // Use the initially determined sheet context
      try {
        // Check current status? Maybe not necessary, just overwrite.
        await this.appraisalService.updateStatus(id, 'Failed', `Error: ${error.message}`, usingCompletedSheet);
      } catch (statusError) {
        this.logger.error(`Error updating final FAILED status for appraisal ${id}:`, statusError);
      }
      
      // Re-throw the error so the API handler returns a 500
      throw error;
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  /**
   * Specialized method to analyze an image with GPT-4o and merge descriptions
   * This method does NOT need the sheet passed in its main signature, as it receives it via `options`
   * @param {string|number} id - Appraisal ID
   * @param {string|number} postId - WordPress post ID
   * @param {string} customerDescription - Customer provided description (optional)
   * @param {object} options - Additional options, expected to contain `usingCompletedSheet`
   * @returns {Promise<object>} - Results of the processing
   */
  async analyzeImageAndMergeDescriptions(id, postId, customerDescription = '', options = {}) {
    if (this.isShuttingDown) {
      this.logger.warn('Worker is shutting down, rejecting new processing request');
      throw new Error('Service is shutting down, try again later');
    }

    const processId = `image-analysis-${id}-${Date.now()}`;
    this.activeProcesses.add(processId);

    // Extract usingCompletedSheet from options, default to false if not provided
    const { usingCompletedSheet = false } = options;

    try {
      this.logger.info(`Starting image analysis and description merging for appraisal ${id} using ${usingCompletedSheet ? 'completed' : 'pending'} sheet`);
      
      // First check if we already have an AI description in column H
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Checking for existing AI description', usingCompletedSheet);
      const existingAiDesc = await this.sheetsService.getValues(`H${id}`, usingCompletedSheet);
      let aiImageDescription = null;
      
      if (existingAiDesc && existingAiDesc[0] && existingAiDesc[0][0]) {
        // Use existing AI description if available
        aiImageDescription = existingAiDesc[0][0];
        this.logger.info(`Using existing AI description found in column H for appraisal ${id} (${aiImageDescription.length} chars)`);
      } else {
        // Only perform image analysis if we don't already have an AI description
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
        
        aiImageDescription = await openaiService.analyzeImageWithGPT4o(mainImageUrl, imageAnalysisPrompt);
        
        if (!aiImageDescription) {
          throw new Error('Failed to generate AI image description');
        }
        
        this.logger.info(`Generated new AI image description (${aiImageDescription.length} chars)`);
        
        // 3. Save the AI image description to the Google Sheet
        await this.appraisalService.updateStatus(id, 'Updating', 'Saving AI image analysis', usingCompletedSheet);
        await this.sheetsService.updateValues(`H${id}`, [[aiImageDescription]], usingCompletedSheet);
      }
      
      // 4. Get or update customer description (appraiser's description from column K)
      // The appraiser's description takes precedence
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
      
      // 5. Merge descriptions (AI image analysis + customer/appraiser description)
      // Note: The OpenAI service is configured to prioritize the appraiser's description (first parameter)
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Merging descriptions (prioritizing appraiser\'s description)', usingCompletedSheet);
      
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
      this.logger.error(`Error analyzing image and merging descriptions for appraisal ${id} on ${usingCompletedSheet ? 'Completed' : 'Pending'} sheet:`, error);
      
      // Update status to failed using the correct sheet
      try {
        await this.appraisalService.updateStatus(id, 'Failed', `Image analysis error: ${error.message}`, usingCompletedSheet);
      } catch (statusError) {
        this.logger.error(`Error updating status for failed image analysis ${id}:`, statusError);
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