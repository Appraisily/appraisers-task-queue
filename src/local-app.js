// This is a modified version of app.js for local development
// It uses mock services instead of the real ones for local testing

const express = require('express');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const helmet = require('helmet');
const path = require('path');

// Use our mock secrets implementation directly
const mockSecretManager = require('./utils/local-dev');

const logger = createLogger('LocalApp');
const app = express();

app.use(cors());
app.use(express.json());
app.use(helmet());

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

// Get appraisal data and log to console - simplified for local testing
app.get('/api/fetch-appraisal/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    
    if (!postId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: postId is required'
      });
    }
    
    logger.info(`[LOCAL DEV] Received request to fetch data for WordPress post ${postId}`);
    
    // For local development, just mock the WordPress response
    const mockPostData = {
      id: postId,
      title: { rendered: `Mock Appraisal Title for ID ${postId}` },
      content: { rendered: '<p>This is a mock appraisal content for local development testing.</p>' },
      acf: {
        appraisaltype: 'Regular',
        status: 'Completed',
        appraisal_value: '$1,000 - $1,500',
        customer_email: 'test@example.com',
        customer_name: 'Test Customer',
        customer_description: 'Customer provided description of the item'
      }
    };
    
    // Log the mock data to console
    logger.info(`===== MOCK WORDPRESS POST ${postId} DATA =====`);
    logger.info(JSON.stringify(mockPostData, null, 2));
    logger.info(`===== END MOCK POST ${postId} DATA =====`);
    
    // Return simplified data to client
    res.status(200).json({
      success: true,
      message: `Mock appraisal data for post ${postId} successfully retrieved and logged to console`,
      data: {
        title: mockPostData.title.rendered,
        type: mockPostData.acf.appraisaltype,
        status: mockPostData.acf.status,
        value: mockPostData.acf.appraisal_value
      }
    });
  } catch (error) {
    logger.error('Error in local development:', error);
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

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info(`[LOCAL DEV] Server running on port ${PORT}`);
  logger.info(`[LOCAL DEV] This is a simplified version for local development`);
  logger.info(`[LOCAL DEV] Try accessing http://localhost:${PORT}/api/fetch-appraisal/123456`);
}); 