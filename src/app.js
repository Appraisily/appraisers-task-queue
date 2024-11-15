const express = require('express');
const cors = require('cors');
const { initializeConfig } = require('./config');
const { initializeProcessor } = require('./processor');

const app = express();
let server;

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

app.get('/health', (req, res) => {
  res.status(200).send('OK');
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
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Starting graceful shutdown...');
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

startServer();