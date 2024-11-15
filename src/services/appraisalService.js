const { config } = require('../config');
const fetch = require('node-fetch');

class AppraisalService {
  constructor() {
    this.baseUrl = config.BACKEND_API_URL;
  }

  async makeAuthenticatedRequest(endpoint, method = 'POST', body = null) {
    try {
      const token = this.generateAuthToken();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        ...(body && { body: JSON.stringify(body) })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error making request to ${endpoint}:`, error);
      throw error;
    }
  }

  generateAuthToken() {
    try {
      if (!config.JWT_SECRET) {
        throw new Error('JWT secret not initialized');
      }
      return jwt.sign(
        { role: 'worker' },
        config.JWT_SECRET,
        { expiresIn: '1h' }
      );
    } catch (error) {
      console.error('Failed to generate worker JWT token:', error);
      throw error;
    }
  }

  async processAppraisal(id, appraisalValue, description) {
    console.log(`Starting appraisal process for ID: ${id}`);
    
    try {
      // Step 1: Set Appraisal Value
      console.log('Step 1: Setting appraisal value...');
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/set-value`,
        'POST',
        { appraisalValue, description }
      );

      // Step 2: Merge Descriptions
      console.log('Step 2: Merging descriptions...');
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/merge-descriptions`,
        'POST',
        { description }
      );

      // Step 3: Update Post Title
      console.log('Step 3: Updating post title...');
      const title = `Appraisal #${id}`; // You might want to generate this differently
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/update-title`,
        'POST',
        { title }
      );

      // Step 4: Insert Template
      console.log('Step 4: Inserting template...');
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/insert-template`,
        'POST'
      );

      // Step 5: Build PDF
      console.log('Step 5: Building PDF...');
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/build-pdf`,
        'POST'
      );

      // Step 6: Send Email
      console.log('Step 6: Sending email...');
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/send-email`,
        'POST'
      );

      // Step 7: Complete Appraisal
      console.log('Step 7: Completing appraisal...');
      await this.makeAuthenticatedRequest(
        `/api/appraisals/${id}/complete`,
        'POST',
        { appraisalValue, description }
      );

      console.log(`✓ Appraisal ${id} processed successfully`);
    } catch (error) {
      console.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }
}

module.exports = new AppraisalService();