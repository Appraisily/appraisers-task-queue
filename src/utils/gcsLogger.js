const { Storage } = require('@google-cloud/storage');

/**
 * Google Cloud Storage Logger
 * Saves logs to GCS bucket in session ID folders
 */
class GCSLogger {
  constructor(bucketName) {
    this.storage = new Storage();
    this.bucketName = bucketName || 'appraisily-image-backups';
  }

  /**
   * Save a log entry to GCS
   * @param {string} sessionId - The session ID from the sheets (column C in Pending Appraisals)
   * @param {string} logType - Type of log (info, error, etc)
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   * @returns {Promise} Promise that resolves when log is saved
   */
  async log(sessionId, logType, message, data = {}) {
    if (!sessionId) {
      console.warn('[GCSLogger] No sessionId provided, skipping GCS logging');
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
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(key);
      await file.save(logString, {
        contentType: 'application/json',
        metadata: {
          contentType: 'application/json'
        }
      });
      
      console.log(`[GCSLogger] Log saved to gs://${this.bucketName}/${key}`);
      return key;
    } catch (error) {
      console.error('[GCSLogger] Error saving log to GCS:', error.message);
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

module.exports = new GCSLogger(); 