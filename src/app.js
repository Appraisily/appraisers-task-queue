const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const sendGridMail = require('@sendgrid/mail');
const OpenAI = require('openai');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { PubSub } = require('@google-cloud/pubsub');

const app = express();
app.use(cors());
app.use(express.json());

// Services
let sheets = null;
let openai = null;
let pubsub = null;

// Initialize everything
async function initialize() {
  try {
    // 1. Get secrets
    const secretManager = new SecretManagerServiceClient();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    
    const getSecret = async (name) => {
      const [version] = await secretManager.accessSecretVersion({
        name: `projects/${projectId}/secrets/${name}/versions/latest`
      });
      return version.payload.data.toString('utf8');
    };

    // 2. Initialize services directly
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheets = google.sheets({ version: 'v4', auth });
    openai = new OpenAI({ apiKey: await getSecret('OPENAI_API_KEY') });
    sendGridMail.setApiKey(await getSecret('SENDGRID_API_KEY'));
    pubsub = new PubSub();

    // 3. Test sheets connection
    const spreadsheetId = await getSecret('PENDING_APPRAISALS_SPREADSHEET_ID');
    await sheets.spreadsheets.get({ spreadsheetId });

    console.log('All services initialized successfully');
    return true;
  } catch (error) {
    console.error('Initialization failed:', error);
    return false;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initialize();
});