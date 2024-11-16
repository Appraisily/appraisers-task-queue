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
        process.exit(1);
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
    // Close Pub/Sub subscription first
    await closeProcessor();
    
    // Then close HTTP server
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

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  isHealthy = false;
  try {
    await closeProcessor();
    process.exit(1);
  } catch (shutdownError) {
    console.error('Error during emergency shutdown:', shutdownError);
    process.exit(1);
  }
});

startServer();