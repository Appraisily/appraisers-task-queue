const AWS = require('aws-sdk');

class S3Logger {
  constructor(bucketName) {
    // Configure AWS SDK to use Google Cloud Storage
    // GCS has an S3-compatible API endpoint
    this.s3 = new AWS.S3({
      endpoint: 'https://storage.googleapis.com',
      region: 'us-central1',
      signatureVersion: 'v4'
    });
    this.bucketName = bucketName || 'appraisily-image-backups';
  }

  /**
   * Save a log entry to S3
   * @param {string} sessionId - The session ID from the sheets (column C in Pending Appraisals)
   * @param {string} logType - Type of log (info, error, etc)
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   * @returns {Promise} Promise that resolves when log is saved
   */
  async log(sessionId, logType, message, data = {}) {
    if (!sessionId) {
      console.warn('[S3Logger] No sessionId provided, skipping S3 logging');
      return;
    }

    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      type: logType,
      message,
      service: 'appraisers-task-queue',
      data
    };

    const logString = JSON.stringify(logData, null, 2);
    const key = `${sessionId}/logs/task_queue_${logType}_${timestamp.replace(/:/g, '-')}.json`;

    try {
      await this.s3.putObject({
        Bucket: this.bucketName,
        Key: key,
        Body: logString,
        ContentType: 'application/json'
      }).promise();
      
      console.log(`[S3Logger] Log saved to gs://${this.bucketName}/${key}`);
      return key;
    } catch (error) {
      console.error('[S3Logger] Error saving log to GCS:', error.message);
      // Continue execution even if logging fails
    }
  }

  /**
   * Log info level message
   */
  async info(sessionId, message, data = {}) {
    return this.log(sessionId, 'info', message, data);
  }

  /**
   * Log error level message
   */
  async error(sessionId, message, data = {}) {
    return this.log(sessionId, 'error', message, data);
  }

  /**
   * Log warning level message
   */
  async warn(sessionId, message, data = {}) {
    return this.log(sessionId, 'warn', message, data);
  }

  /**
   * Log debug level message
   */
  async debug(sessionId, message, data = {}) {
    return this.log(sessionId, 'debug', message, data);
  }
}

module.exports = new S3Logger(); 