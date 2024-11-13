const { google } = require('googleapis');
const { getSecret } = require('../utils/secretManager');

async function initializeSheets() {
  try {
    const serviceAccount = await getSecret('service-account-json');

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccount),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    console.log('Authenticated with Google Sheets API');
    return sheets;
  } catch (error) {
    console.error('Error authenticating with Google Sheets API:', error);
    throw error;
  }
}

module.exports = { initializeSheets };