const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getSecret } = require('../utils/secretManager');
const { config } = require('../config');

class ApiService {
  constructor() {
    this.baseUrl = config.BACKEND_API_URL;
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
}

module.exports = new ApiService();