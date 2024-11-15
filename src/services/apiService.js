const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getSecret } = require('../utils/secretManager');
const { config } = require('../config');

class ApiService {
  constructor() {
    this.baseUrl = 'https://appraisers-backend-856401495068.us-central1.run.app';
    this.jwtSecret = null;
  }

  async initializeJwtSecret() {
    if (!this.jwtSecret) {
      try {
        this.jwtSecret = await getSecret('jwt-secret');
        console.log('JWT secret loaded successfully for worker authentication');
      } catch (error) {
        console.error('Failed to load JWT secret:', error);
        throw new Error('Could not initialize worker authentication');
      }
    }
  }

  generateAuthToken() {
    try {
      if (!this.jwtSecret) {
        throw new Error('JWT secret not initialized');
      }
      return jwt.sign(
        { role: 'worker' },
        this.jwtSecret,
        { expiresIn: '1h' }
      );
    } catch (error) {
      console.error('Failed to generate worker JWT token:', error);
      throw error;
    }
  }

  async makeAuthenticatedRequest(endpoint, method = 'POST', body = null) {
    try {
      await this.initializeJwtSecret();
      const token = this.generateAuthToken();
      const url = `${this.baseUrl}${endpoint}`;
      
      console.log(`Making ${method} request to: ${url}`);
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const response = await fetch(url, {
        method,
        headers,
        ...(body && { body: JSON.stringify(body) })
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('API Error Response:', {
          status: response.status,
          statusText: response.statusText,
          data: responseData
        });
        throw new Error(responseData.message || `HTTP error! status: ${response.status}`);
      }

      console.log(`✓ ${method} ${endpoint} successful`);
      return responseData;
    } catch (error) {
      console.error(`Error making request to ${endpoint}:`, error);
      throw error;
    }
  }
}

module.exports = new ApiService();