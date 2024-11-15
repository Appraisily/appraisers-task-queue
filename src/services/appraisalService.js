const apiService = require('./apiService');
const AppraisalSteps = require('./appraisalSteps');

class AppraisalService {
  constructor() {
    this.steps = new AppraisalSteps(apiService);
  }

  async processAppraisal(id, appraisalValue, description) {
    console.log(`Starting appraisal process for ID: ${id}`);
    
    try {
      await this.steps.setAppraisalValue(id, appraisalValue, description);
      await this.steps.mergeDescriptions(id, description);
      await this.steps.updatePostTitle(id);
      await this.steps.insertTemplate(id);
      await this.steps.buildPDF(id);
      await this.steps.sendEmail(id);
      await this.steps.completeAppraisal(id, appraisalValue, description);

      console.log(`✓ Appraisal ${id} processed successfully`);
    } catch (error) {
      console.error(`Error processing appraisal ${id}:`, error);
      throw error;
    }
  }
}

module.exports = new AppraisalService();