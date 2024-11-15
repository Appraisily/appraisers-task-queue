const { config } = require('../config');

class AppraisalSteps {
  constructor(apiService) {
    this.apiService = apiService;
  }

  async setAppraisalValue(id, appraisalValue, description) {
    console.log('Step 1: Setting appraisal value...');
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/set-value`,
      'POST',
      { appraisalValue, description }
    );
  }

  async mergeDescriptions(id, description) {
    console.log('Step 2: Merging descriptions...');
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/merge-descriptions`,
      'POST',
      { description }
    );
  }

  async updatePostTitle(id) {
    console.log('Step 3: Updating post title...');
    const title = `Appraisal #${id}`;
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/update-title`,
      'POST',
      { title }
    );
  }

  async insertTemplate(id) {
    console.log('Step 4: Inserting template...');
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/insert-template`,
      'POST'
    );
  }

  async buildPDF(id) {
    console.log('Step 5: Building PDF...');
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/build-pdf`,
      'POST'
    );
  }

  async sendEmail(id) {
    console.log('Step 6: Sending email...');
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/send-email`,
      'POST'
    );
  }

  async completeAppraisal(id, appraisalValue, description) {
    console.log('Step 7: Completing appraisal...');
    return await this.apiService.makeAuthenticatedRequest(
      `/api/appraisals/${id}/complete`,
      'POST',
      { appraisalValue, description }
    );
  }
}

module.exports = AppraisalSteps;