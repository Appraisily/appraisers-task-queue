const { Storage } = require('@google-cloud/storage');

/**
 * Google Cloud Storage Logger with batch capabilities
 * Saves logs to GCS bucket in session ID folders
 */
class GCSLogger {
  constructor(bucketName) {
    this.storage = new Storage();
    this.bucketName = bucketName || 'appraisily-image-backups';
    
    // Batch logging storage 
    this.logBatches = new Map(); // sessionId -> array of log entries
    this.batchLimits = {
      maxSize: 100, // Max number of logs per batch before auto-save
      flushTimeoutMs: 60000 // 1 minute timeout before auto-save
    };
    this.batchTimers = new Map(); // sessionId -> timeout handle
  }

  /**
   * Add a log entry to the batch for the given session ID
   * @param {string} sessionId - The session ID
   * @param {string} logType - Type of log (info, error, etc)
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   */
  async log(sessionId, logType, message, data = {}) {
    if (!sessionId) {
      console.warn('[GCSLogger] No sessionId provided, skipping GCS logging');
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      type: logType,
      message,
      service: 'appraisers-task-queue',
      data
    };

    // Create a new batch if one doesn't exist for this session
    if (!this.logBatches.has(sessionId)) {
      this.logBatches.set(sessionId, []);
      
      // Set a timer to flush this batch after the timeout
      const timeoutHandle = setTimeout(() => {
        this.flushBatch(sessionId);
      }, this.batchLimits.flushTimeoutMs);
      
      this.batchTimers.set(sessionId, timeoutHandle);
    }

    // Add to the batch
    const batch = this.logBatches.get(sessionId);
    batch.push(logEntry);
    
    // Check if we need to flush the batch (if it's an error or batch size limit reached)
    if (logType === 'error' || batch.length >= this.batchLimits.maxSize) {
      await this.flushBatch(sessionId);
    }
  }

  /**
   * Flush the batch of logs for the given session ID to GCS
   * @param {string} sessionId - The session ID 
   */
  async flushBatch(sessionId) {
    // Clear any pending timeout
    if (this.batchTimers.has(sessionId)) {
      clearTimeout(this.batchTimers.get(sessionId));
      this.batchTimers.delete(sessionId);
    }
    
    // Get the batch and clear it from memory
    if (!this.logBatches.has(sessionId) || this.logBatches.get(sessionId).length === 0) {
      return; // Nothing to flush
    }
    
    const batch = this.logBatches.get(sessionId);
    this.logBatches.set(sessionId, []); // Reset batch while we process
    
    try {
      const timestamp = new Date().toISOString();
      const fileName = `task_queue_batch_${timestamp.replace(/:/g, '-')}.json`;
      const key = `${sessionId}/logs/${fileName}`;
      
      const logString = JSON.stringify({
        timestamp,
        service: 'appraisers-task-queue',
        entries: batch
      }, null, 2);
      
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(key);
      
      await file.save(logString, {
        contentType: 'application/json',
        metadata: {
          contentType: 'application/json'
        }
      });
      
      console.log(`[GCSLogger] Batch of ${batch.length} logs saved to gs://${this.bucketName}/${key}`);
    } catch (error) {
      console.error('[GCSLogger] Error saving log batch to GCS:', error.message);
      // Don't attempt to retry - this could cause infinite loops
    }
  }

  /**
   * Manually flush all pending log batches
   * Useful for shutdown or process completion
   */
  async flushAll() {
    const sessionIds = Array.from(this.logBatches.keys());
    
    for (const sessionId of sessionIds) {
      await this.flushBatch(sessionId);
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