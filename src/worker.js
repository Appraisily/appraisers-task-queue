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
      
      // Initialize all services
      await this.sheetsService.initialize({ PENDING_APPRAISALS_SPREADSHEET_ID: spreadsheetId });
      const wordpressService = new WordPressService();
      const openaiService = new OpenAIService();
      const emailService = new EmailService();
      const pdfService = new PDFService();
      
      // Initialize services concurrently
      await Promise.all([
        wordpressService.initialize(),
        openaiService.initialize(),
        emailService.initialize(),
        pdfService.initialize()
      ]);
      
      // Initialize appraisal finder
      this.appraisalFinder = new AppraisalFinder(this.sheetsService);
      
      // Initialize AppraisalService with all dependencies
      this.appraisalService = new AppraisalService(
        this.sheetsService,
        wordpressService,
        openaiService,
        emailService,
        pdfService
      );
      
      this.logger.info('Worker initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize worker:', error);
      throw error;
    }
  }

  /**
   * Process an appraisal from a specific step via direct API call
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
      this.logger.info(`Processing appraisal ${id} from step ${startStep} (Sheet: ${usingCompletedSheet ? 'Completed' : 'Pending'})`);
      
      // Extract any additional data from options that might be needed
      const { appraisalValue, description, appraisalType, postId } = options;
      
      // Process based on step
      switch (startStep) {
        case 'STEP_SET_VALUE':
          try {
            // Fetch all required data in a single operation
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
            await this.appraisalService.processAppraisal(id, valueToUse, descToUse, appraisalType, usingCompletedSheet);
          } catch (error) {
            this.logger.error(`Error in STEP_SET_VALUE:`, error);
            await this.appraisalService.updateStatus(id, 'Failed', `STEP_SET_VALUE Error: ${error.message}`, usingCompletedSheet);
            throw error;
          }
          break;
          
        case 'STEP_MERGE_DESCRIPTIONS':
          try {
            // Get all data we need in a single call, passing the sheet flag
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['G', 'J', 'K'], usingCompletedSheet);
            
            if (!appraisalData.G) {
              throw new Error(`No WordPress URL found for appraisal ${id}`);
            }
            
            // Extract post ID from WordPress URL
            const wpUrl = appraisalData.G;
            const url = new URL(wpUrl);
            const postId = url.searchParams.get('post');
            
            if (!postId) {
              throw new Error(`Could not extract post ID from WordPress URL`);
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
              usingCompletedSheet: usingCompletedSheet
            });
            
            // Save titles to Google Sheets
            await this.sheetsService.updateValues(`S${id}`, [[analysisResult.briefTitle]], usingCompletedSheet);
            await this.sheetsService.updateValues(`T${id}`, [[analysisResult.mergedDescription]], usingCompletedSheet);
            
            // Only update WordPress if we have new data to set
            if (analysisResult && analysisResult.briefTitle && analysisResult.mergedDescription) {
              // Use the brief title for the WordPress post title
              // Use the merged description as the detailed title
              await this.appraisalService.wordpressService.updateAppraisalPost(postId, {
                title: analysisResult.briefTitle,
                detailedtitle: analysisResult.mergedDescription
              });
            }
            
            // Final status update in Google Sheets
            await this.appraisalService.updateStatus(id, 'Ready', 'Description merged and metadata updated', usingCompletedSheet);
          } catch (error) {
            this.logger.error(`Error in STEP_MERGE_DESCRIPTIONS:`, error);
            await this.appraisalService.updateStatus(id, 'Failed', `MERGE_DESC Error: ${error.message}`, usingCompletedSheet);
            throw error;
          }
          
          break;
          
        case 'STEP_UPDATE_WORDPRESS':
          try {
            // Fetch required data using the known sheet
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'L'], usingCompletedSheet);
            
            const valueToUse = appraisalValue || (appraisalData.J || 0);
            const descriptionToUse = appraisalData.L || '';
            const typeToUse = appraisalType || appraisalData.B || 'Regular';
            
            // Update WordPress
            await this.appraisalService.updateStatus(id, 'Updating', 'Setting titles and metadata in WordPress', usingCompletedSheet);
            
            // Create a proper structure for the merged description to match what mergeDescriptions returns
            const mergeResult = {
              mergedDescription: descriptionToUse,
              briefTitle: '', 
              detailedTitle: descriptionToUse
            };
            
            await this.appraisalService.updateWordPress(id, valueToUse, mergeResult, typeToUse, usingCompletedSheet);
          } catch (error) {
             this.logger.error(`Error in STEP_UPDATE_WORDPRESS:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `UPDATE_WP Error: ${error.message}`, usingCompletedSheet);
             throw error;
          }
          break;
          
        case 'STEP_GENERATE_VISUALIZATION':
          try {
            // Get the PostID either from options or from spreadsheet (using the known sheet)
            let postIdToUse = postId;
            if (!postIdToUse) {
                const { data: postData } = await this.appraisalFinder.getMultipleFields(id, ['G'], usingCompletedSheet);
                
                if (!postData || !postData.G) {
                   throw new Error('WordPress URL not found');
                }
                 // Extract post ID from WordPress URL
                const wpUrl = postData.G;
                const url = new URL(wpUrl);
                postIdToUse = url.searchParams.get('post');
                if (!postIdToUse) {
                  throw new Error(`Could not extract post ID from WordPress URL`);
                }
            }
            
            // Complete the report (which includes visualizations)
            await this.appraisalService.wordpressService.completeAppraisalReport(postIdToUse);
          } catch (error) {
             this.logger.error(`Error in STEP_GENERATE_VISUALIZATION:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `GEN_VIS Error: ${error.message}`, usingCompletedSheet);
             throw error;
          }
          break;
          
        case 'STEP_GENERATE_PDF':
          try {
            // Get PostID using the appraisalFinder utility with the known sheet
            let pdfPostId = postId;
            if (!pdfPostId) {
               const { data: postData } = await this.appraisalFinder.getMultipleFields(id, ['G'], usingCompletedSheet);
                if (!postData || !postData.G) {
                  throw new Error('WordPress URL not found');
                }
                const wpUrl = postData.G;
                const url = new URL(wpUrl);
                pdfPostId = url.searchParams.get('post');
                if (!pdfPostId) {
                  throw new Error(`Could not extract post ID from WordPress URL`);
                }
            }
            
            // Update status
            await this.appraisalService.updateStatus(id, 'Finalizing', 'Creating PDF document', usingCompletedSheet);
            
            // Get public URL
            const publicUrl = await this.appraisalService.wordpressService.getPermalink(pdfPostId);
            
            // Generate PDF - this will throw an error if the PDF generation fails
            const pdfResult = await this.appraisalService.finalize(id, pdfPostId, publicUrl, usingCompletedSheet);
            
            // Validate PDF URLs
            if (!pdfResult.pdfLink || pdfResult.pdfLink.includes('placeholder')) {
              throw new Error(`PDF generation returned placeholder or invalid URLs`);
            }
            
            // Mark as complete if it was a full process (only if in pending sheet)
            if (!usingCompletedSheet) {
              await this.appraisalService.updateStatus(id, 'Completed', 'PDF created and emailed to customer', usingCompletedSheet);
            }
            
          } catch (error) {
            this.logger.error(`Error in STEP_GENERATE_PDF:`, error);
            await this.appraisalService.updateStatus(id, 'Failed', `GEN_PDF Error: ${error.message}`, usingCompletedSheet);
            throw error;
          }
          break;
          
        case 'STEP_BUILD_REPORT':
          try {
            await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheet);
            
            // Fetch required data using the known sheet
            const { data: appraisalData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'K'], usingCompletedSheet);
            
            const type = appraisalData.B || 'Regular';
            const appraisalValueFromSheet = appraisalData.J; // Column J
            const descriptionFromSheet = appraisalData.K; // Column K
            
            // Process appraisal with existing data
            await this.appraisalService.processAppraisal(
              id, 
              appraisalValueFromSheet, 
              descriptionFromSheet, 
              type,
              usingCompletedSheet
            );
           } catch (error) {
             this.logger.error(`Error in STEP_BUILD_REPORT:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `BUILD_REPORT Error: ${error.message}`, usingCompletedSheet);
             throw error;
          }
          break;
          
        default:
          this.logger.warn(`Unknown step: ${startStep}. Attempting to run full process.`);
          
          try {
             // Update status
             await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow (default step)', usingCompletedSheet);
             
             // Get all necessary data from the spreadsheet using the known sheet
             const { data: defaultData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'K'], usingCompletedSheet);
             
             const defaultType = defaultData.B || 'Regular';
             const defaultValue = defaultData.J; // Column J
             const defaultDesc = defaultData.K; // Column K
             
             await this.appraisalService.processAppraisal(
               id,
               defaultValue,
               defaultDesc,
               defaultType,
               usingCompletedSheet
             );
           } catch (error) {
             this.logger.error(`Error in default processing:`, error);
             await this.appraisalService.updateStatus(id, 'Failed', `DEFAULT Error: ${error.message}`, usingCompletedSheet);
             throw error;
          }
      }
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id} from step ${startStep}:`, error.message);
      
      try {
        await this.appraisalService.updateStatus(id, 'Failed', `Error: ${error.message}`, usingCompletedSheet);
      } catch (statusError) {
        this.logger.error(`Error updating final status:`, statusError);
      }
      
      throw error;
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  /**
   * Specialized method to analyze an image with GPT-4o and merge descriptions
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
      // First check if we already have an AI description in column H
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Checking for existing AI description', usingCompletedSheet);
      const existingAiDesc = await this.sheetsService.getValues(`H${id}`, usingCompletedSheet);
      let aiImageDescription = null;
      
      if (existingAiDesc && existingAiDesc[0] && existingAiDesc[0][0]) {
        // Use existing AI description if available
        aiImageDescription = existingAiDesc[0][0];
      } else {
        // Only perform image analysis if we don't already have an AI description
        await this.appraisalService.updateStatus(id, 'Analyzing', 'Retrieving image for AI analysis', usingCompletedSheet);

        // 1. Get the main image from WordPress
        const wordpressService = this.appraisalService.wordpressService;
        const postData = await wordpressService.getPost(postId);
        
        if (!postData) {
          throw new Error(`Failed to retrieve post data for post ID ${postId}`);
        }
        
        // Get the main image URL from ACF fields
        let mainImageUrl = null;
        
        if (postData.acf && postData.acf.main) {
          // Use the WordPress service's getImageUrl method
          mainImageUrl = await wordpressService.getImageUrl(postData.acf.main);
        }
        
        // If main image not found, try to use the featured image
        if (!mainImageUrl && postData.featured_media_url) {
          mainImageUrl = postData.featured_media_url;
        }
        
        if (!mainImageUrl) {
          throw new Error('No main image found in the WordPress post');
        }
        
        // 2. Analyze the image with o3
        await this.appraisalService.updateStatus(id, 'Analyzing', 'Generating AI image analysis with o3', usingCompletedSheet);
        const openaiService = this.appraisalService.openaiService;
        
        const imageAnalysisPrompt = 
          "You are an expert art and antiquity appraiser with decades of experience. " +
          "Please analyze this image thoroughly and provide a highly detailed, professional description of what you see. " +
          "Focus extensively on ALL aspects including: style, period, materials, condition, craftsmanship, artistic significance, " +
          "provenance if evident, color palette, composition, dimensions (if estimable), cultural or historical context, " +
          "decorative elements, patterns, iconography, techniques used, age indicators, " +
          "any signatures or markings, quality assessment, rarity indicators, and all other notable features. " +
          "If it's an antiquity, describe its historical context, original purpose, and cultural significance in detail. " +
          "Be extremely thorough and maximize the amount of information extracted from visual examination. " +
          "Do not omit any details visible in the image. " +
          "End with a brief title (3-7 words) that captures the essence of the item.";
        
        // Call o3 to analyze the image
        this.logger.debug(`Calling o3 Vision API for image analysis`);
        aiImageDescription = await openaiService.analyzeImageWithGPT4o(mainImageUrl, imageAnalysisPrompt);
        
        if (!aiImageDescription) {
          this.logger.error(`o3 vision API returned empty result`);
          throw new Error('Image analysis failed - empty result from o3');
        }
        
        // Save the AI description to column H
        this.logger.debug(`Saving generated AI description to Google Sheets`);
        await this.sheetsService.updateValues(`H${id}`, [[aiImageDescription]], usingCompletedSheet);
      }
      
      // 3. Merge customer description with AI description
      this.logger.debug(`Merging customer description with AI description`);
      const openaiService = this.appraisalService.openaiService;
      const mergeResult = await openaiService.mergeDescriptions(customerDescription || '', aiImageDescription || '');
      
      return mergeResult;
    } catch (error) {
      this.logger.error(`Error analyzing image and merging descriptions:`, error);
      await this.appraisalService.updateStatus(id, 'Failed', `Analysis Error: ${error.message}`, usingCompletedSheet);
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