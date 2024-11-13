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

  // Implementation of individual steps...
  // Each step from the original appraisalSteps.js would be implemented here
  // but organized in a more modular way
}

module.exports = new AppraisalService();