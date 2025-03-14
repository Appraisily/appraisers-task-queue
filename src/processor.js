/**
 * @deprecated This file is maintained for backward compatibility only.
 * Use the worker.js module directly instead.
 */

const worker = require('./worker');

/**
 * Initialize the processor (delegates to worker)
 * @returns {Promise<void>}
 */
async function initializeProcessor() {
  return worker.initialize();
}

/**
 * Close the processor (delegates to worker)
 * @returns {Promise<void>}
 */
async function closeProcessor() {
  return worker.shutdown();
}

module.exports = { 
  initializeProcessor, 
  closeProcessor,
  // For direct access to the worker
  worker
};