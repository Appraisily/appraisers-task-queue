const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { createLogger } = require('./logger');

class SecretManager {
  constructor() {
    this.logger = createLogger('SecretManager');
    this.client = new SecretManagerServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  }

  async getSecret(name) {
    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${name}/versions/latest`
      });

      return version.payload.data.toString('utf8');
    } catch (error) {
      this.logger.error(`Error getting secret ${name}:`, error);
      throw error;
    }
  }
}

module.exports = new SecretManager();