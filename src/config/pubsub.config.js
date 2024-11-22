const PUBSUB_CONFIG = {
  subscription: {
    name: 'appraisal-tasks-subscription',
    settings: {
      ackDeadlineSeconds: 600,
      messageRetentionDuration: { seconds: 604800 },
      expirationPolicy: { ttl: null },
      enableMessageOrdering: true,
      retryPolicy: {
        minimumBackoff: { seconds: 10 },
        maximumBackoff: { seconds: 600 }
      },
      deadLetterPolicy: {
        maxDeliveryAttempts: 5
      }
    }
  },
  topics: {
    main: 'appraisal-tasks',
    failed: 'appraisals-failed'
  },
  retry: {
    maxAttempts: 10,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  },
  healthCheck: {
    interval: 15000,
    timeout: 5000
  },
  flowControl: {
    maxMessages: 100,
    allowExcessMessages: false
  }
};

module.exports = { PUBSUB_CONFIG };