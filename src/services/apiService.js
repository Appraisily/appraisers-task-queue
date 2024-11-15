const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getSecret } = require('../utils/secretManager');
const { config } = require('../config');

class ApiService {
  constructor() {
    this.baseUrl = 'https://appraisers-backend-856401495068.us-central1.run.app';
    this.jwtSecret = null;
    this.retryCount = 3;
    this.retryDelay = 1000; // Start with 1 second delay
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

  async makeAuthenticatedRequest(endpoint, method = 'POST', body = null, attempt = 1) {
    try {
      await this.initializeJwtSecret();
      const token = this.generateAuthToken();
      const url = `${this.baseUrl}${endpoint}`;
      
      console.log(`Making ${method} request to: ${url} (attempt ${attempt}/${this.retryCount})`);
      
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
        // If it's a token error and not the last attempt, retry
        if (response.status === 401 && attempt < this.retryCount) {
          console.log('Token expired or invalid, retrying with new token...');
          this.jwtSecret = null; // Force new token generation
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
          return this.makeAuthenticatedRequest(endpoint, method, body, attempt + 1);
        }

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
      // Retry on network errors
      if (error.name === 'FetchError' && attempt < this.retryCount) {
        console.log(`Network error, retrying in ${this.retryDelay * attempt}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
        return this.makeAuthenticatedRequest(endpoint, method, body, attempt + 1);
      }

      console.error(`Error making request to ${endpoint}:`, error);
      throw error;
    }
  }
}

module.exports = new ApiService();