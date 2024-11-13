const { config } = require('../config');
const { initializeSheets } = require('./googleSheets');
const emailService = require('./emailService');
const fetch = require('node-fetch');

class AppraisalService {
  async processAppraisal(id, appraisalValue, description) {
    try {
      const sheets = await initializeSheets();
      
      await this.setAppraisalValue(sheets, id, appraisalValue, description);
      await this.mergeDescriptions(sheets, id, description);
      const postId = await this.updatePostTitle(sheets, id);
      await this.insertTemplate(sheets, id);
      await this.completeAppraisalText(postId, id);
      await this.buildPDF(sheets, id);
      await this.sendEmailToCustomer(sheets, id);
      await this.markAsCompleted(sheets, id, appraisalValue, description);
      
      console.log(`Appraisal ${id} processed successfully`);
    } catch (error) {
      console.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }

  async setAppraisalValue(sheets, id, value, description) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!A${id}:E${id}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[value, description]]
        }
      });
      console.log(`Set appraisal value for ID ${id}`);
    } catch (error) {
      console.error('Error setting appraisal value:', error);
      throw error;
    }
  }

  async mergeDescriptions(sheets, id, newDescription) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!F${id}`;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range
      });
      
      const existingDescription = response.data.values?.[0]?.[0] || '';
      const mergedDescription = `${existingDescription}\n${newDescription}`.trim();
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[mergedDescription]]
        }
      });
      console.log(`Merged descriptions for ID ${id}`);
    } catch (error) {
      console.error('Error merging descriptions:', error);
      throw error;
    }
  }

  async updatePostTitle(sheets, id) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!G${id}`;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range
      });
      
      const title = response.data.values?.[0]?.[0];
      if (!title) throw new Error('Post title not found');
      
      const postResponse = await fetch(`${config.WORDPRESS_API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${config.WORDPRESS_USERNAME}:${config.WORDPRESS_APP_PASSWORD}`).toString('base64')
        },
        body: JSON.stringify({
          title,
          status: 'draft'
        })
      });
      
      const post = await postResponse.json();
      console.log(`Created WordPress post for ID ${id}`);
      return post.id;
    } catch (error) {
      console.error('Error updating post title:', error);
      throw error;
    }
  }

  async insertTemplate(sheets, id) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!H${id}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['Template inserted']]
        }
      });
      console.log(`Inserted template for ID ${id}`);
    } catch (error) {
      console.error('Error inserting template:', error);
      throw error;
    }
  }

  async completeAppraisalText(postId, id) {
    try {
      const response = await fetch(`${config.WORDPRESS_API_URL}/posts/${postId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${config.WORDPRESS_USERNAME}:${config.WORDPRESS_APP_PASSWORD}`).toString('base64')
        },
        body: JSON.stringify({
          status: 'publish'
        })
      });
      
      if (!response.ok) throw new Error('Failed to complete appraisal text');
      console.log(`Completed appraisal text for ID ${id}`);
    } catch (error) {
      console.error('Error completing appraisal text:', error);
      throw error;
    }
  }

  async buildPDF(sheets, id) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!I${id}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['PDF built']]
        }
      });
      console.log(`Built PDF for ID ${id}`);
    } catch (error) {
      console.error('Error building PDF:', error);
      throw error;
    }
  }

  async sendEmailToCustomer(sheets, id) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!J${id}:K${id}`;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range
      });
      
      const [email, name] = response.data.values?.[0] || [];
      if (!email || !name) throw new Error('Customer email or name not found');
      
      await emailService.sendAppraisalCompletedEmail(email, name, {
        value: await this.getAppraisalValue(sheets, id),
        description: await this.getDescription(sheets, id),
        pdfLink: await this.getPDFLink(sheets, id)
      });
      console.log(`Sent email to customer for ID ${id}`);
    } catch (error) {
      console.error('Error sending email to customer:', error);
      throw error;
    }
  }

  async markAsCompleted(sheets, id, value, description) {
    try {
      const range = `${config.GOOGLE_SHEET_NAME}!L${id}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['Completed']]
        }
      });
      console.log(`Marked as completed for ID ${id}`);
    } catch (error) {
      console.error('Error marking as completed:', error);
      throw error;
    }
  }

  async getAppraisalValue(sheets, id) {
    const range = `${config.GOOGLE_SHEET_NAME}!A${id}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
      range
    });
    return response.data.values?.[0]?.[0];
  }

  async getDescription(sheets, id) {
    const range = `${config.GOOGLE_SHEET_NAME}!F${id}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
      range
    });
    return response.data.values?.[0]?.[0];
  }

  async getPDFLink(sheets, id) {
    const range = `${config.GOOGLE_SHEET_NAME}!M${id}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.PENDING_APPRAISALS_SPREADSHEET_ID,
      range
    });
    return response.data.values?.[0]?.[0];
  }
}

module.exports = new AppraisalService();