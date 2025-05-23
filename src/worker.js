const { createLogger } = require('./utils/logger');
const secretManager = require('./utils/secrets');
const SheetsService = require('./services/sheets.service');
const WordPressService = require('./services/wordpress.service');
const OpenAIService = require('./services/openai.service');
const CrmService = require('./services/crm.service');
const PDFService = require('./services/pdf.service');
const AppraisalService = require('./services/appraisal.service');
const AppraisalFinder = require('./utils/appraisal-finder');
const MigrationService = require('./services/migration.service');

class Worker {
  constructor() {
    this.logger = createLogger('Worker');
    this.sheetsService = new SheetsService();
    this.appraisalService = null;
    this.migrationService = null;
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
      const crmService = new CrmService();
      const pdfService = new PDFService();
      
      // Initialize core services concurrently - CRM service is allowed to fail
      try {
        await Promise.all([
          wordpressService.initialize(),
          openaiService.initialize(),
          crmService.initialize().catch(error => {
            this.logger.warn(`CRM service initialization failed: ${error.message}`);
            this.logger.warn('Continuing without CRM notification capabilities');
            return false;
          }),
          pdfService.initialize()
        ]);
      } catch (serviceError) {
        // If any critical service fails to initialize, throw the error
        throw new Error(`Failed to initialize core services: ${serviceError.message}`);
      }
      
      // Initialize appraisal finder
      this.appraisalFinder = new AppraisalFinder(this.sheetsService);
      
      // Initialize AppraisalService with all dependencies
      this.appraisalService = new AppraisalService(
        this.sheetsService,
        wordpressService,
        openaiService,
        crmService, // Pass CRM service even if initialization failed
        pdfService
      );
      
      // Initialize MigrationService
      this.migrationService = new MigrationService(wordpressService);
      await this.migrationService.initialize();
      
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
    
    // Check if this is a reprocessing request that should skip sheet operations
    const skipSheetOperations = options.reprocess === true;
    if (skipSheetOperations) {
      this.logger.info(`Reprocessing appraisal ${id} from step ${startStep} - skipping sheet operations`);
    }

    try {
      this.logger.info(`Processing appraisal ${id} from step ${startStep} (Sheet: ${usingCompletedSheet ? 'Completed' : 'Pending'}, Reprocess: ${skipSheetOperations})`);
      
      const { 
        appraisalValue, 
        description, 
        appraisalType, 
        postId,
        geminiAnalysis // New field containing the Gemini AI analysis
      } = options;
      
      // Process based on step
      switch (startStep) {
        case 'STEP_SET_VALUE':
          try {
            // Use provided values directly from options as the source of truth.
            // If we have geminiAnalysis, extract values from it
            const valueToUse = this.extractAppraisalValue(appraisalValue, geminiAnalysis);
            const descToUse = this.extractDescription(description, geminiAnalysis);
            const typeToUse = this.extractAppraisalType(appraisalType, geminiAnalysis);
            
            if (valueToUse === undefined || valueToUse === null || descToUse === undefined || descToUse === null) {
              this.logger.error(`Missing required fields from backend for STEP_SET_VALUE: appraisalValue (${valueToUse}), description (${descToUse}) for ID ${id}`);
              throw new Error('Missing required fields from backend for STEP_SET_VALUE: appraisalValue or description must be provided.');
            }
            
            // Update status with the correct sheet (passed as parameter)
            if (!skipSheetOperations) {
              await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow', usingCompletedSheet);
            }
            
            // Process the appraisal
            await this.appraisalService.processAppraisal(
              id, 
              valueToUse, 
              descToUse,
              typeToUse, 
              skipSheetOperations ? null : usingCompletedSheet // Pass null to skip sheet operations
            );
          } catch (error) {
            this.logger.error(`Error in STEP_SET_VALUE:`, error);
            if (!skipSheetOperations) {
              await this.appraisalService.updateStatus(id, 'Failed', `SET_VALUE Error: ${error.message}`, usingCompletedSheet);
            }
            throw error;
          }
          break;
          
        case 'STEP_MERGE_DESCRIPTIONS':
          try {
            if (!skipSheetOperations) {
              await this.appraisalService.updateStatus(id, 'Analyzing', 'Merging descriptions', usingCompletedSheet);
            }
            
            // Get existing descriptions if not provided in options
            let descriptionToUse = description;
            let postIdToUse = postId;
            
            if (!descriptionToUse && !skipSheetOperations) {
              // Read customer description from column K
              const { data: descData } = await this.appraisalFinder.getMultipleFields(id, ['K'], usingCompletedSheet);
              if (descData && descData.K) {
                descriptionToUse = descData.K;
              } else {
                this.logger.warn(`No description found in column K for appraisal ${id}`);
              }
            }
            
            // Get WordPress post ID if not provided in options
            if (!postIdToUse && !skipSheetOperations) {
              try {
                const { postId: fetchedPostId } = await this.appraisalService.getWordPressPostId(id, usingCompletedSheet);
                postIdToUse = fetchedPostId;
              } catch (error) {
                this.logger.error(`Error getting WordPress post ID:`, error);
                throw new Error(`Failed to get WordPress post ID: ${error.message}`);
              }
            }
            
            // Ensure we have post ID
            if (!postIdToUse) {
              throw new Error(`No WordPress post ID available. Cannot merge descriptions.`);
            }
            
            // Call the specialized method for image analysis and description merging
            const analysisResult = await this.analyzeImageAndMergeDescriptions(
              id, 
              postIdToUse, 
              descriptionToUse || '', 
              { usingCompletedSheet, skipSheetOperations }
            );
            
            // If we should skip sheet operations, we're done here
            if (skipSheetOperations) {
              this.logger.info(`Reprocessing completed for STEP_MERGE_DESCRIPTIONS`);
              break;
            }
            
            // Save the result to columns S and T
            await this.sheetsService.updateValues(`S${id}`, [[analysisResult.briefTitle || '']], usingCompletedSheet);
            await this.sheetsService.updateValues(`T${id}`, [[analysisResult.detailedTitle || '']], usingCompletedSheet);
            
            // Update WordPress post with the new titles
            try {
              await this.wordpressService.updatePostTitles(postIdToUse, {
                title: analysisResult.briefTitle,
                detailedTitle: analysisResult.detailedTitle
              });
              
              await this.appraisalService.updateStatus(id, 'Ready', 'Descriptions merged successfully', usingCompletedSheet);
            } catch (wpError) {
              this.logger.error(`Error updating WordPress post titles:`, wpError);
              await this.appraisalService.updateStatus(id, 'Warning', `Descriptions merged but WordPress update failed`, usingCompletedSheet);
            }
          } catch (error) {
            this.logger.error(`Error in STEP_MERGE_DESCRIPTIONS:`, error);
            if (!skipSheetOperations) {
              await this.appraisalService.updateStatus(id, 'Failed', `MERGE_DESC Error: ${error.message}`, usingCompletedSheet);
            }
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
            const pdfResult = await this.appraisalService.finalize(id, pdfPostId, publicUrl, usingCompletedSheet, false);
            
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
             if (!skipSheetOperations) {
               await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow (default step)', usingCompletedSheet);
             }
             
             // Get all necessary data from the spreadsheet using the known sheet
             let defaultType = 'Regular';
             let defaultValue = '';
             let defaultDesc = '';
             
             if (!skipSheetOperations) {
               const { data: defaultData } = await this.appraisalFinder.getMultipleFields(id, ['B', 'J', 'K'], usingCompletedSheet);
               defaultType = defaultData.B || 'Regular';
               defaultValue = defaultData.J || ''; // Column J
               defaultDesc = defaultData.K || ''; // Column K
             } else {
               // Use values from options when reprocessing
               defaultType = appraisalType || 'Regular';
               defaultValue = appraisalValue || '';
               defaultDesc = description || '';
             }
             
             await this.appraisalService.processAppraisal(
               id,
               defaultValue,
               defaultDesc,
               defaultType,
               skipSheetOperations ? null : usingCompletedSheet
             );
          } catch (error) {
            this.logger.error(`Error in default case:`, error);
            if (!skipSheetOperations) {
              await this.appraisalService.updateStatus(id, 'Failed', `Error: ${error.message}`, usingCompletedSheet);
            }
            throw error;
          }
      }
    } catch (error) {
      this.logger.error(`Error processing appraisal ${id} from step ${startStep}:`, error);
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

    // Extract options
    const { usingCompletedSheet = false, skipSheetOperations = false } = options;

    try {
      // First check if we already have an AI description in column H
      let aiImageDescription = null;
      
      if (!skipSheetOperations) {
        await this.appraisalService.updateStatus(id, 'Analyzing', 'Checking for existing AI description', usingCompletedSheet);
        const existingAiDesc = await this.sheetsService.getValues(`H${id}`, usingCompletedSheet);
        
        if (existingAiDesc && existingAiDesc[0] && existingAiDesc[0][0]) {
          // Use existing AI description if available
          aiImageDescription = existingAiDesc[0][0];
        }
      }
      
      if (!aiImageDescription) {
        // Only perform image analysis if we don't already have an AI description
        if (!skipSheetOperations) {
          await this.appraisalService.updateStatus(id, 'Analyzing', 'Retrieving image for AI analysis', usingCompletedSheet);
        }

        // 1. Get the main image from WordPress
        const wordpressService = this.appraisalService.wordpressService;
        const postData = await wordpressService.getPost(postId);
        
        if (!postData) {
          throw new Error(`Could not retrieve WordPress post data for ID ${postId}`);
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
        if (!skipSheetOperations) {
          await this.appraisalService.updateStatus(id, 'Analyzing', 'Generating AI image analysis with o3', usingCompletedSheet);
        }
        const openaiService = this.appraisalService.openaiService;
        
        const imageAnalysisPrompt = 
          "You are an expert art and antiquity appraiser with decades of experience. " +
          "Please analyze this image thoroughly and provide a highly detailed, professional description of what you see. " +
          "Focus extensively on ALL aspects including: style, period, materials, condition, craftsmanship, artistic significance, " +
          "provenance if evident, color palette, composition, dimensions (if estimable), cultural or historical context, " +
          "decorative elements, patterns, iconography, techniques used, age indicators, " +
          "any signatures or markings, quality assessment, rarity indicators, and all other notable features. " +
          "If it's an antiquity, describe its historical context, original purpose, and cultural significance in detail. " +
          "Be extremely thorough but avoid speculation when information is not visible in the image. " +
          "Do not omit any details visible in the image. " +
          "End with a brief title (3-7 words) that captures the essence of the item.";
        
        // Call o3 to analyze the image
        this.logger.debug(`Calling o3 Vision API for image analysis`);
        aiImageDescription = await openaiService.analyzeImageWithGPT4o(mainImageUrl, imageAnalysisPrompt);
        
        if (!aiImageDescription) {
          this.logger.error(`o3 vision API returned empty result`);
          throw new Error('Image analysis failed - empty result from o3');
        }
        
        // Save the AI description to column H if not skipping sheet operations
        if (!skipSheetOperations) {
          this.logger.debug(`Saving generated AI description to Google Sheets`);
          await this.sheetsService.updateValues(`H${id}`, [[aiImageDescription]], usingCompletedSheet);
        }
      }
      
      // 3. Merge customer description with AI description
      this.logger.debug(`Merging customer description with AI description`);
      const openaiService = this.appraisalService.openaiService;
      const mergeResult = await openaiService.mergeDescriptions(customerDescription || '', aiImageDescription || '');
      
      return mergeResult;
    } catch (error) {
      this.logger.error(`Error analyzing image and merging descriptions:`, error);
      if (!skipSheetOperations) {
        await this.appraisalService.updateStatus(id, 'Failed', `Analysis Error: ${error.message}`, usingCompletedSheet);
      }
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

  /**
   * Migrate an appraisal from an existing URL to the new format
   * @param {object} params - Migration parameters
   * @param {string} params.url - The URL of the existing appraisal
   * @param {string} params.sessionId - The session ID for the new appraisal
   * @param {string} params.customerEmail - The customer's email address
   * @param {object} params.options - Additional options
   * @returns {Promise<object>} - The migration data
   */
  async migrateAppraisal(params) {
    if (this.isShuttingDown) {
      this.logger.warn('Worker is shutting down, rejecting new migration request');
      throw new Error('Service is shutting down, try again later');
    }

    const processId = `migrate-${params.sessionId}-${Date.now()}`;
    this.activeProcesses.add(processId);

    try {
      this.logger.info(`Starting appraisal migration from URL: ${params.url}`);
      
      // Validate required parameters
      if (!params.url) {
        throw new Error('URL is required');
      }
      
      if (!params.sessionId) {
        throw new Error('Session ID is required');
      }
      
      if (!params.customerEmail) {
        throw new Error('Customer email is required');
      }
      
      // Use the migration service to migrate the appraisal
      const migrationData = await this.migrationService.migrateAppraisal(params);
      
      this.logger.info(`Migration completed successfully for session ID: ${params.sessionId}`);
      return migrationData;
    } catch (error) {
      this.logger.error(`Error migrating appraisal:`, error);
      throw error;
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  /**
   * Extract appraisal value from options or Gemini analysis
   * @param {string|number} providedValue - Value provided directly in options
   * @param {object} geminiAnalysis - Gemini AI analysis object
   * @returns {string} - The appraisal value to use
   */
  extractAppraisalValue(providedValue, geminiAnalysis) {
    // Direct value has highest priority
    if (providedValue !== undefined && providedValue !== null && providedValue !== '') {
      return providedValue;
    }
    
    // Try to get value from Gemini analysis
    if (geminiAnalysis && geminiAnalysis.recommendedValue) {
      return geminiAnalysis.recommendedValue;
    }
    
    return providedValue || '';
  }
  
  /**
   * Extract description from options or Gemini analysis
   * @param {string} providedDescription - Description provided directly in options
   * @param {object} geminiAnalysis - Gemini AI analysis object
   * @returns {string} - The description to use
   */
  extractDescription(providedDescription, geminiAnalysis) {
    // Direct description has highest priority
    if (providedDescription && providedDescription.trim()) {
      return providedDescription;
    }
    
    // Try to get merged description from Gemini analysis
    if (geminiAnalysis && geminiAnalysis.mergedDescription) {
      return geminiAnalysis.mergedDescription;
    }
    
    return providedDescription || '';
  }
  
  /**
   * Extract appraisal type from options or Gemini analysis
   * @param {string} providedType - Type provided directly in options
   * @param {object} geminiAnalysis - Gemini AI analysis object
   * @returns {string} - The appraisal type to use
   */
  extractAppraisalType(providedType, geminiAnalysis) {
    // Direct type has highest priority
    if (providedType && providedType.trim()) {
      return providedType;
    }
    
    // Map object type to appraisal type if available
    if (geminiAnalysis && geminiAnalysis.objectType) {
      // Map common object types to appraisal types
      const objectType = geminiAnalysis.objectType.toLowerCase();
      
      if (objectType.includes('painting') || 
          objectType.includes('artwork') || 
          objectType.includes('drawing')) {
        return 'Art';
      } else if (objectType.includes('jewelry') || 
                 objectType.includes('gold') || 
                 objectType.includes('silver') ||
                 objectType.includes('gem')) {
        return 'Jewelry';
      } else if (objectType.includes('furniture') || 
                 objectType.includes('chair') || 
                 objectType.includes('table')) {
        return 'Furniture';
      } else if (objectType.includes('collectible') || 
                 objectType.includes('memorabilia')) {
        return 'Collectible';
      }
    }
    
    // Default to Regular if nothing else is available
    return providedType || 'Regular';
  }
}

// Export a singleton instance
const worker = new Worker();
module.exports = worker;