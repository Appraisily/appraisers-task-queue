const { createLogger } = require('./utils/logger');
const secretManager = require('./utils/secrets');
const SheetsService = require('./services/sheets.service');
const WordPressService = require('./services/wordpress.service');
const OpenAIService = require('./services/openai.service');
const EmailService = require('./services/email.service');
const PDFService = require('./services/pdf.service');
const AppraisalService = require('./services/appraisal.service');

class Worker {
  constructor() {
    this.logger = createLogger('Worker');
    this.sheetsService = new SheetsService();
    this.appraisalService = null;
    this.activeProcesses = new Set();
    this.isShuttingDown = false;
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
      
      await Promise.all([
        wordpressService.initialize(),
        openaiService.initialize(),
        emailService.initialize(),
        pdfService.initialize()
      ]);
      
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
          // First step, so we need all fields
          if (!appraisalValue && !description) {
            throw new Error('Missing required fields for STEP_SET_VALUE: appraisalValue or description');
          }
          // Start full processing
          await this.appraisalService.processAppraisal(id, appraisalValue, description, appraisalType);
          break;
          
        case 'STEP_MERGE_DESCRIPTIONS':
          // Need description at minimum
          if (!this.appraisalService) {
            throw new Error('Appraisal service not initialized');
          }
          // Need to get existing data
          const existingData = await this.sheetsService.getValues(`J${id}:K${id}`);
          if (!existingData || !existingData[0]) {
            throw new Error('No existing data found for appraisal');
          }
          const [value, existingDescription] = existingData[0];
          // Use provided description or existing one
          const descToUse = description || existingDescription;
          if (!descToUse) {
            throw new Error('No description provided or found for merge step');
          }
          
          await this.appraisalService.mergeDescriptions(id, descToUse);
          break;
          
        case 'STEP_UPDATE_WORDPRESS':
          if (!this.appraisalService) {
            throw new Error('Appraisal service not initialized');
          }
          // Get required data from spreadsheet
          const [valueData, descData, appraisalTypeData] = await Promise.all([
            this.sheetsService.getValues(`J${id}`),  // Value
            this.sheetsService.getValues(`L${id}`),  // Merged description
            this.sheetsService.getValues(`B${id}`)   // Appraisal type
          ]);
          
          const valueToUse = appraisalValue || (valueData?.[0]?.[0] || 0);
          const descriptionToUse = descData?.[0]?.[0] || '';
          const typeToUse = appraisalType || appraisalTypeData?.[0]?.[0] || 'Regular';
          
          // Update WordPress
          await this.appraisalService.updateStatus(id, 'Updating', 'Setting titles and metadata in WordPress');
          await this.appraisalService.updateWordPress(id, valueToUse, descriptionToUse, typeToUse);
          break;
          
        case 'STEP_GENERATE_VISUALIZATION':
          if (!this.appraisalService) {
            throw new Error('Appraisal service not initialized');
          }
          
          // Get the PostID either from options or from spreadsheet
          let postIdToUse = postId;
          if (!postIdToUse) {
            postIdToUse = await this.appraisalService.getWordPressPostId(id);
          }
          
          if (!postIdToUse) {
            throw new Error('Post ID is required for generating visualizations');
          }
          
          // Update status
          await this.appraisalService.updateStatus(id, 'Generating', 'Creating visualizations');
          
          // Complete the report (which includes visualizations)
          await this.wordpressService.completeAppraisalReport(postIdToUse);
          
          // Update status when done
          await this.appraisalService.updateStatus(id, 'Generating', 'Visualizations created successfully');
          break;
          
        case 'STEP_GENERATE_PDF':
          if (!this.appraisalService) {
            throw new Error('Appraisal service not initialized');
          }
          
          // Get PostID
          let pdfPostId = postId;
          if (!pdfPostId) {
            pdfPostId = await this.appraisalService.getWordPressPostId(id);
          }
          
          if (!pdfPostId) {
            throw new Error('Post ID is required for generating PDF');
          }
          
          // Update status
          await this.appraisalService.updateStatus(id, 'Finalizing', 'Creating PDF document');
          
          // Get public URL
          const publicUrl = await this.appraisalService.wordpressService.getPermalink(pdfPostId);
          
          // Generate PDF
          const pdfResult = await this.appraisalService.finalize(id, pdfPostId, publicUrl);
          
          // Update status
          await this.appraisalService.updateStatus(id, 'Finalizing', `PDF created: ${pdfResult.pdfLink}`);
          
          // Mark as complete if was a full process
          await this.appraisalService.updateStatus(id, 'Completed', 'PDF created and emailed to customer');
          break;
          
        case 'STEP_BUILD_REPORT':
          // New step to handle building the full report
          if (!this.appraisalService) {
            throw new Error('Appraisal service not initialized');
          }
          
          await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow');
          
          // Run the full process starting from the beginning
          // Get required data from spreadsheet
          const fullProcessData = await this.sheetsService.getValues(`B${id}:L${id}`);
          if (!fullProcessData || !fullProcessData[0]) {
            throw new Error('No data found for appraisal');
          }
          
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
          // Fall back to full process
          await this.appraisalService.updateStatus(id, 'Processing', 'Starting appraisal workflow');
          
          // Get all necessary data from the spreadsheet
          const defaultData = await this.sheetsService.getValues(`B${id}:L${id}`);
          if (!defaultData || !defaultData[0]) {
            throw new Error('No data found for appraisal');
          }
          
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
        if (this.appraisalService) {
          await this.appraisalService.updateStatus(id, 'Failed', `Error: ${error.message}`);
        }
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
      this.logger.info(`Starting image analysis and description merging for appraisal ${id}`);
      
      if (!this.appraisalService) {
        throw new Error('Appraisal service not initialized');
      }

      // Update status
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Retrieving image for AI analysis');

      // 1. Get the main image from WordPress
      const wordpressService = this.appraisalService.wordpressService;
      const postData = await wordpressService.getPost(postId);
      
      if (!postData) {
        throw new Error(`Failed to retrieve post data for post ID ${postId}`);
      }
      
      // Get the main image URL from ACF fields
      const mainImageUrl = postData.acf?.main_image?.url || postData.acf?.image?.url;
      
      if (!mainImageUrl) {
        throw new Error('No main image found in the WordPress post');
      }
      
      this.logger.info(`Retrieved main image URL: ${mainImageUrl}`);
      
      // 2. Analyze the image with GPT-4o
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Generating AI image analysis with GPT-4o');
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
      await this.appraisalService.updateStatus(id, 'Updating', 'Saving AI image analysis');
      await this.sheetsService.updateValues(`H${id}`, [[aiImageDescription]]);
      
      // 4. Get or update customer description
      if (customerDescription) {
        await this.sheetsService.updateValues(`K${id}`, [[customerDescription]]);
      } else {
        // Try to get existing customer description if not provided
        const existingData = await this.sheetsService.getValues(`K${id}`);
        if (existingData && existingData[0] && existingData[0][0]) {
          customerDescription = existingData[0][0];
        } else {
          // If still no customer description is available, use an empty string as fallback
          this.logger.warn(`No customer description found for appraisal ${id}, using empty string`);
          customerDescription = '';
        }
      }
      
      // 5. Merge descriptions (AI image analysis + customer description)
      await this.appraisalService.updateStatus(id, 'Analyzing', 'Merging descriptions');
      
      const mergeResult = await this.appraisalService.mergeDescriptions(id, customerDescription);
      
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
      
      await this.appraisalService.updateStatus(id, 'Ready', 'Image analysis and description merging completed');
      
      this.logger.info(`Successfully completed image analysis and description merging for appraisal ${id}`);
      
      return result;
    } catch (error) {
      this.logger.error(`Error analyzing image and merging descriptions for appraisal ${id}:`, error);
      
      // Update status to failed
      try {
        if (this.appraisalService) {
          await this.appraisalService.updateStatus(id, 'Failed', `Image analysis error: ${error.message}`);
        }
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