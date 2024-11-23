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
  console.log('🚀 Starting service initialization...');
  
  try {
    // 1. Get secrets
    console.log('📦 Initializing Secret Manager...');
    const secretManager = new SecretManagerServiceClient();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    console.log(`   Project ID: ${projectId}`);
    
    const getSecret = async (name) => {
      console.log(`   Loading secret: ${name}...`);
      const [version] = await secretManager.accessSecretVersion({
        name: `projects/${projectId}/secrets/${name}/versions/latest`
      });
      const value = version.payload.data.toString('utf8').trim();
      console.log(`   ✓ Secret ${name} loaded successfully`);
      return value;
    };

    // 2. Initialize services
    console.log('🔄 Initializing core services...');

    console.log('   Initializing Google Auth...');
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const client = await auth.getClient();
    console.log(`   ✓ Using service account: ${await auth.getCredentials().then(creds => creds.client_email)}`);

    console.log('   Initializing Google Sheets...');
    sheets = google.sheets({ version: 'v4', auth });
    
    console.log('   Initializing OpenAI...');
    openai = new OpenAI({ apiKey: await getSecret('OPENAI_API_KEY') });
    console.log('   ✓ OpenAI initialized');

    console.log('   Initializing SendGrid...');
    sendGridMail.setApiKey(await getSecret('SENDGRID_API_KEY'));
    console.log('   ✓ SendGrid initialized');

    console.log('   Initializing PubSub...');
    pubsub = new PubSub();
    console.log('   ✓ PubSub initialized');

    // 3. Test sheets connection
    console.log('📊 Testing Google Sheets connection...');
    const spreadsheetId = await getSecret('PENDING_APPRAISALS_SPREADSHEET_ID');
    console.log(`   Using spreadsheet ID: ${spreadsheetId}`);
    
    const response = await sheets.spreadsheets.get({ 
      spreadsheetId,
      fields: 'properties.title'
    });
    
    console.log(`   ✓ Connected to sheet: "${response.data.properties.title}"`);
    console.log('✅ All services initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    if (error.response?.data) {
      console.error('   Error details:', JSON.stringify(error.response.data, null, 2));
    }
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
  console.log(`\n🌐 Server running on port ${PORT}`);
  await initialize();
});