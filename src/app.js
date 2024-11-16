const express = require('express');
const cors = require('cors');
const { initializeConfig } = require('./config');
const { initializeProcessor, closeProcessor } = require('./processor');

const app = express();
let server;
let isHealthy = false;

const corsOptions = {
  origin: [
    'https://appraisers-frontend-856401495068.us-central1.run.app',
    'https://jazzy-lollipop-0a3217.netlify.app',
    'https://earnest-choux-a0ec16.netlify.app',
    'https://appraisily.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  if (isHealthy) {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } else {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      message: 'Service is starting or recovering'
    });
  }
});

async function startServer() {
  try {
    // Initialize configuration first
    await initializeConfig();
    
    const PORT = process.env.PORT || 8080;
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Task Queue service running on port ${PORT}`);
    });

    // Initialize processor after server is running
    await initializeProcessor();
    isHealthy = true;

    // Handle server errors
    server.on('error', async (error) => {
      console.error('Server error:', error);
      isHealthy = false;
      // Attempt graceful recovery
      try {
        await closeProcessor();
        await initializeProcessor();
        isHealthy = true;
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError);
      }
    });

  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Starting graceful shutdown...');
  isHealthy = false;
  try {
    await closeProcessor();
    
    if (server) {
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Handle uncaught exceptions without exiting
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  isHealthy = false;
  try {
    // Don't close the processor, just try to recover
    await initializeProcessor();
    isHealthy = true;
  } catch (recoveryError) {
    console.error('Error during recovery:', recoveryError);
  }
});

// Handle unhandled promise rejections without exiting
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  isHealthy = false;
  try {
    // Don't close the processor, just try to recover
    await initializeProcessor();
    isHealthy = true;
  } catch (recoveryError) {
    console.error('Error during recovery:', recoveryError);
  }
});

startServer();