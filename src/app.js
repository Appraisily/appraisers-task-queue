const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const worker = require('./worker');

const logger = createLogger('App');
const app = express();

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
    '/api/generate-appraisal-doc': {
      methods: ['POST', 'GET'],
      description: 'Generate Google Doc and optionally PDF from WordPress post using Markdown template',
      requestFormat: {
        postId: 'String - WordPress post ID',
        outputFormat: 'String - Output format: docs or pdf (default: docs)'
      }
    },
    '/api/fetch-appraisal/:postId': {
      methods: ['GET'],
      description: 'Fetch and log appraisal data from WordPress post to console',
      requestFormat: {
        postId: 'String - WordPress post ID in URL path'
      },
      response: {
        success: 'Boolean indicating success status',
        message: 'String indicating operation result',
        data: 'Object with simplified appraisal information'
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

// Generate appraisal document (Google Doc/PDF) from WordPress post
app.post('/api/generate-appraisal-doc', async (req, res) => {
  try {
    const { postId, outputFormat = 'docs' } = req.body;
    
    if (!postId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: postId is required'
      });
    }
    
    logger.info(`Received request to generate ${outputFormat} for WordPress post ${postId}`);
    
    // Generate the document
    const result = await worker.generateAppraisalDocument(postId, {
      convertToPdf: outputFormat === 'pdf'
    });
    
    // Return appropriate response based on format
    if (outputFormat === 'pdf') {
      res.contentType('application/pdf');
      res.send(result.fileContent);
    } else {
      res.json({
        success: true,
        docUrl: result.docUrl,
        docId: result.docId,
        message: 'Google Doc created successfully',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Error generating appraisal document:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// RESTful endpoint to generate document directly by ID in URL
app.get('/api/generate-appraisal-doc/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const outputFormat = req.query.format || 'docs'; // Get format from query string
    
    logger.info(`Received request to generate ${outputFormat} for WordPress post ${postId} (via GET)`);
    
    // Generate the document
    const result = await worker.generateAppraisalDocument(postId, {
      convertToPdf: outputFormat === 'pdf'
    });
    
    // Return appropriate response based on format
    if (outputFormat === 'pdf') {
      res.contentType('application/pdf');
      res.send(result.fileContent);
    } else {
      res.json({
        success: true,
        docUrl: result.docUrl,
        docId: result.docId,
        message: 'Google Doc created successfully',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Error generating appraisal document:', error);
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
    
    logger.info(`Received request to fetch data for WordPress post ${postId}`);
    
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
    
    // Return simplified data to client
    res.status(200).json({
      success: true,
      message: `Appraisal data for post ${postId} successfully retrieved and logged to console`,
      data: {
        title: postData.title?.rendered || '',
        type: postData.acf?.appraisaltype || '',
        status: postData.acf?.status || '',
        value: postData.acf?.appraisal_value || ''
      }
    });
  } catch (error) {
    logger.error('Error fetching appraisal data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

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

// Start server and initialize worker
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  
  try {
    await worker.initialize();
    logger.info('Worker initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize worker:', error);
    process.exit(1);
  }
});