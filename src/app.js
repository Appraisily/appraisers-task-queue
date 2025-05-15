const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const worker = require('./worker');
const path = require('path');
const templateLoader = require('./utils/template-loader');
const GeminiService = require('./services/gemini.service');

const logger = createLogger('App');
const app = express();
const geminiService = new GeminiService();

app.use(cors());
app.use(express.json());

// API endpoints documentation
const API_DOCUMENTATION = {
  endpoints: {
    '/health': {
      methods: ['GET'],
      description: 'Health check endpoint to verify service availability',
      response: {
        status: 'String indicating service status (ok)',
        timestamp: 'ISO timestamp of the response'
      }
    },
    '/api/process-step': {
      methods: ['POST'],
      description: 'Endpoint for processing an appraisal from a specific step',
      requestFormat: {
        id: 'String - Unique identifier for the appraisal',
        startStep: 'String - The step to start processing from',
        options: 'Object - Additional options for processing'
      }
    },
    '/api/analyze-image-and-merge': {
      methods: ['POST'],
      description: 'Specialized endpoint for analyzing images with GPT-4o and merging descriptions',
      requestFormat: {
        id: 'String - Unique identifier for the appraisal',
        postId: 'String - WordPress post ID',
        description: 'String - Customer description (optional)',
        options: 'Object - Additional options for processing'
      }
    },
    '/api/fetch-appraisal/:postId': {
      methods: ['GET'],
      description: 'Fetch, analyze, and structure appraisal data from WordPress using Gemini AI',
      requestFormat: {
        postId: 'String - WordPress post ID in URL path'
      },
      response: {
        success: 'Boolean indicating success status',
        message: 'String indicating operation result',
        data: {
          postId: 'WordPress post ID',
          title: 'Post title',
          content: 'Post content',
          appraisalType: 'Type of appraisal',
          appraisalValue: 'Extracted appraisal value',
          imageUrls: 'Array of image URLs with types',
          metadata: 'All extracted ACF fields',
          analysis: 'Structured data from Gemini AI',
          processedData: 'Payload ready for STEP_SET_VALUE processing'
        }
      }
    },
    '/api/migrate-appraisal': {
      methods: ['POST'],
      description: 'Migrate an existing appraisal to the new format',
      requestFormat: {
        url: 'String - The URL of the existing appraisal to migrate',
        sessionId: 'String - The session ID for the new appraisal process',
        customerEmail: 'String - The customer\'s email address',
        options: 'Object - Additional options for processing (optional)'
      }
    }
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Documentation endpoint
app.get('/api/docs', (req, res) => {
  res.status(200).json(API_DOCUMENTATION);
});

// Process a specific step
app.post('/api/process-step', async (req, res) => {
  const { id, startStep, options = {} } = req.body;
  
  if (!id || !startStep) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters: id and startStep are required'
    });
  }
  
  logger.info(`Received request to process appraisal ${id} from step ${startStep}`);
  
  try {
    // Ensure worker and finder are initialized
    if (!worker || !worker.appraisalFinder) {
      throw new Error('Worker or AppraisalFinder not initialized');
    }

    // Determine the correct sheet *before* calling the worker
    const { exists, usingCompletedSheet } = await worker.appraisalFinder.appraisalExists(id);

    if (!exists) {
      logger.error(`Appraisal ${id} not found in either sheet.`);
      return res.status(404).json({
        success: false,
        message: `Appraisal ${id} not found in either Pending or Completed sheets.`
      });
    }
    
    logger.info(`Appraisal ${id} found in ${usingCompletedSheet ? 'Completed' : 'Pending'} sheet. Starting process...`);

    // Pass the determined sheet flag to the worker method
    await worker.processFromStep(id, startStep, usingCompletedSheet, options);
    
    res.status(200).json({
      success: true,
      message: `Appraisal ${id} has been processed from step ${startStep}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error processing appraisal ${id} from step ${startStep}:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Specialized endpoint for image analysis and description merging
app.post('/api/analyze-image-and-merge', async (req, res) => {
  const { id, postId, description = '', options = {} } = req.body;
  
  if (!id || !postId) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters: id and postId are required'
    });
  }
  
  logger.info(`Received request to analyze image and merge descriptions for appraisal ${id}, post ${postId}`);
  
  try {
    // Process the image analysis and merge descriptions
    const result = await worker.analyzeImageAndMergeDescriptions(id, postId, description, options);
    
    res.status(200).json({
      success: true,
      message: `Image analyzed and descriptions merged for appraisal ${id}`,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error analyzing image and merging descriptions for appraisal ${id}:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Migration endpoint for migrating existing appraisals to new format
app.post('/api/migrate-appraisal', async (req, res) => {
  try {
    const { url, sessionId, customerEmail, options = {} } = req.body;
    
    // Validate required parameters
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: url is required'
      });
    }
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: sessionId is required'
      });
    }
    
    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: customerEmail is required'
      });
    }
    
    logger.info(`Received request to migrate appraisal from URL: ${url}`);
    
    // Call the worker to handle the migration
    const migrationData = await worker.migrateAppraisal({
      url,
      sessionId,
      customerEmail,
      options
    });
    
    res.status(200).json({
      success: true,
      message: 'Appraisal migration data prepared successfully',
      data: migrationData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error migrating appraisal:', error);
    
    // Determine appropriate status code based on error
    let statusCode = 500;
    if (error.message.includes('Invalid appraisal URL')) {
      statusCode = 400;
    } else if (error.message.includes('Failed to fetch URL')) {
      statusCode = 404;
    }
    
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Get appraisal data and log to console
app.get('/api/fetch-appraisal/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    
    if (!postId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: postId is required'
      });
    }
    
    logger.info(`Received request to fetch and analyze data for WordPress post ${postId}`);
    
    // Make sure worker and wordpressService are initialized
    if (!worker.appraisalService || !worker.appraisalService.wordpressService) {
      throw new Error('Worker or WordPress service not properly initialized');
    }
    
    // Get WordPress data directly from the service
    const wordpressService = worker.appraisalService.wordpressService;
    const postData = await wordpressService.getPost(postId);
    
    if (!postData) {
      throw new Error(`Failed to retrieve post data for post ID ${postId}`);
    }
    
    // Log the complete data to console
    logger.info(`===== WORDPRESS POST ${postId} DATA =====`);
    logger.info(JSON.stringify(postData, null, 2));
    logger.info(`===== END POST ${postId} DATA =====`);
    
    // Extract all relevant data for analysis
    const extractedData = await extractAppraisalData(postData, wordpressService);
    
    // Initialize Gemini service if not already initialized
    if (!geminiService.isInitialized()) {
      await geminiService.initialize();
    }
    
    // Process the extracted data with Gemini to get structured analysis
    logger.info(`Processing appraisal data with Gemini for post ${postId}`);
    const analysisResult = await geminiService.processAppraisalData(extractedData);

    // Only return the required fields in the response
    const minimalAppraisalData = {
      title: analysisResult.title || '',
      value: analysisResult.value || '',
      imageURLs: analysisResult.imageURLs || [],
      sessionID: analysisResult.sessionID || '',
      customerEmail: analysisResult.customerEmail || '',
      detailedTitle: analysisResult.detailedTitle || ''
    };

    res.status(200).json({
      success: true,
      message: `Appraisal data for post ${postId} successfully analyzed and processed`,
      data: minimalAppraisalData
    });
  } catch (error) {
    logger.error('Error fetching and analyzing appraisal data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * Extract comprehensive appraisal data from WordPress post
 * @param {Object} postData - WordPress post data
 * @param {Object} wordpressService - WordPress service instance
 * @returns {Promise<Object>} - Extracted appraisal data
 */
async function extractAppraisalData(postData, wordpressService) {
  try {
    // Extract main post data
    const title = postData.title?.rendered || '';
    const content = postData.content?.rendered || '';
    const appraisalType = postData.acf?.appraisaltype || '';
    const appraisalValue = postData.acf?.appraisal_value || postData.acf?.value || '';
    
    // Extract value from content if not in ACF
    let extractedValue = '';
    if (!appraisalValue && content) {
      // Look for value patterns in content
      const valueMatch = content.match(/\$([0-9,]+)/);
      if (valueMatch && valueMatch[1]) {
        extractedValue = valueMatch[1].replace(/,/g, '');
      }
    }
    
    // Get all image URLs
    const imageUrls = [];
    
    // Main featured image
    if (postData.featured_media) {
      try {
        const featuredUrl = postData.featured_media;
        if (featuredUrl) {
          imageUrls.push({ type: 'featured', url: featuredUrl });
        }
      } catch (error) {
        logger.warn(`Could not retrieve featured image for post ${postData.id}:`, error);
      }
    }
    
    // ACF main image
    if (postData.acf?.main) {
      try {
        const mainImageUrl = postData.acf.main;
        if (mainImageUrl) {
          imageUrls.push({ type: 'main', url: mainImageUrl });
        }
      } catch (error) {
        logger.warn(`Could not retrieve ACF main image for post ${postData.id}:`, error);
      }
    }
    
    // ACF images gallery
    if (postData.acf?.images && Array.isArray(postData.acf.images)) {
      for (const image of postData.acf.images) {
        try {
          const galleryImageUrl = image;
          if (galleryImageUrl) {
            imageUrls.push({ type: 'gallery', url: galleryImageUrl });
          }
        } catch (error) {
          logger.warn(`Could not retrieve gallery image for post ${postData.id}:`, error);
        }
      }
    }
    
    // Extract all metadata from ACF fields
    const metadata = { ...postData.acf };
    
    // Clean up metadata by removing large fields and image references
    // that we've already processed
    delete metadata.main;
    delete metadata.images;
    delete metadata.appraisal_content;
    
    // Look for customer email in metadata or author information
    let customerEmail = metadata.customer_email || '';
    if (!customerEmail && postData.author_info) {
      customerEmail = postData.author_info.user_email || '';
    }
    
    // Look for session ID in metadata
    const sessionId = metadata.session_id || metadata.appraisal_id || '';
    
    return {
      postId: postData.id,
      title,
      content,
      appraisalType,
      appraisalValue: appraisalValue || extractedValue,
      imageUrls,
      metadata,
      customerEmail,
      sessionId,
      date: postData.date || '',
      author: postData.author || '',
      excerpt: postData.excerpt?.rendered || '',
      link: postData.link || '',
      status: postData.status || ''
    };
  } catch (error) {
    logger.error('Error extracting appraisal data:', error);
    throw error;
  }
}

/**
 * Extract the appraisal value from the analysis and data
 * @param {Object} extractedData - Extracted WordPress data
 * @param {Object} analysis - Gemini analysis result
 * @returns {string} - The appraisal value
 */
function extractAnalysisValue(extractedData, analysis) {
  // First check if there's a value in the extracted data
  if (extractedData.appraisalValue) {
    return extractedData.appraisalValue;
  }
  
  // Check if the analysis contains a value
  const description = analysis.mergedDescription || '';
  
  // Look for currency patterns in the description
  const valueMatch = description.match(/\$([0-9,]+)/);
  if (valueMatch && valueMatch[1]) {
    return valueMatch[1].replace(/,/g, '');
  }
  
  // Default to empty string if no value found
  return '';
}

// 404 handler for undefined routes
app.use((req, res, next) => {
  logger.warn(`Not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    documentation: API_DOCUMENTATION
  });
});

// Error handling middleware for malformed requests
app.use((err, req, res, next) => {
  logger.error('Request error:', err);
  
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Malformed request: Invalid JSON',
      documentation: API_DOCUMENTATION
    });
  }
  
  // Handle all other errors
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    documentation: API_DOCUMENTATION
  });
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal} signal. Starting graceful shutdown...`);
  
  try {
    await worker.shutdown();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers with longer timeout
const SHUTDOWN_TIMEOUT = 60000; // 60 seconds
process.on('SIGTERM', () => {
  const shutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  
  // Clear the timeout if shutdown completes normally
  shutdown('SIGTERM').finally(() => clearTimeout(shutdownTimer));
});

process.on('SIGINT', () => {
  const shutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  
  // Clear the timeout if shutdown completes normally
  shutdown('SIGINT').finally(() => clearTimeout(shutdownTimer));
});

// Initialize the worker
worker.initialize()
  .then(() => {
    logger.info('Worker initialized successfully');
    
    // Configure template loader if MASTER_TEMPLATE_PATH is set
    if (process.env.MASTER_TEMPLATE_PATH) {
      const masterTemplatePath = process.env.MASTER_TEMPLATE_PATH;
      logger.info(`Setting master template path to ${masterTemplatePath}`);
      templateLoader.setMasterTemplatePath(masterTemplatePath);
    }
    
    // Start the server
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  })
  .catch(error => {
    logger.error('Failed to initialize worker:', error);
    process.exit(1);
  });